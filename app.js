let projectLoaded = false;
let projectChapters = [];

let cssHistory = [];
let historyIndex = -1;
let isHistoryNavigation = false;
let historyTimeout;

// --- NEW: CSS Parser State ---
let parsedCSS = {};

// --- NEW: Chapter-specific settings ---
// Stores centering options per chapter index: { 0: { headings: true, paragraphs: false, ... }, ... }
let chapterCenteringSettings = {};

async function pickProject() {
    const res = await fetch("/pick-folder");
    const data = await res.json();
    if (data.path) loadProject();
}

async function loadProject() {
    const res = await fetch("/load-project");
    const data = await res.json();

    document.getElementById("project-name").innerText = data.projectName;
    document.getElementById("css-editor").value = data.css;

    projectChapters = data.chapters;
    const select = document.getElementById("chapter-select");
    select.innerHTML = '';

    projectChapters.forEach((chapter, index) => {
        const opt = document.createElement("option");
        opt.value = index;
        opt.innerText = chapter.name;
        select.appendChild(opt);
    });

    window.sampleMd = projectChapters.length > 0 ? projectChapters[0].content : '';
    projectLoaded = true;

    // --- NEW: Reset history and push initial loaded state ---
    cssHistory = [];
    historyIndex = -1;
    pushHistory(data.css);

    // NEW: Synchronize the Visual Editor on load
    loadVisualEditorState();
    updatePreview();
}

// --- NEW: Tab Switching Logic ---
function switchTab(tabId) {
    document.getElementById('tab-btn-visual').classList.remove('active');
    document.getElementById('tab-btn-raw').classList.remove('active');
    document.getElementById('visual-tab').style.display = 'none';
    document.getElementById('raw-tab').style.display = 'none';

    document.getElementById(`tab-btn-${tabId}`).classList.add('active');
    document.getElementById(`${tabId}-tab`).style.display = 'flex';
}

// --- NEW: Visual CSS Editor Logic ---
function parseRawCSS() {
    const raw = document.getElementById("css-editor").value;
    parsedCSS = {};

    // Basic regex to extract selectors and their properties
    const regex = /([^{]+)\{([^}]+)\}/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
        const selector = match[1].trim();
        const rulesText = match[2].trim();
        parsedCSS[selector] = {};

        const rules = rulesText.split(';');
        for (let rule of rules) {
            const parts = rule.split(':');
            if (parts.length >= 2) {
                const prop = parts.shift().trim();
                const val = parts.join(':').trim();
                if (prop && val) parsedCSS[selector][prop] = val;
            }
        }
    }
}

function serializeCSS() {
    let css = "/* Auto-Generated CSS via Visual Builder */\n";
    for (const selector in parsedCSS) {
        const props = parsedCSS[selector];
        if (Object.keys(props).length === 0) continue;

        css += `${selector} {\n`;
        for (const prop in props) {
            css += `  ${prop}: ${props[prop]};\n`;
        }
        css += `}\n\n`;
    }
    document.getElementById("css-editor").value = css;
}

function getChapterSpecificSelector(selector, chapterIndex) {
    const mainClass = document.getElementById('class-input').value.trim() || 'book-content';
    const mainClassWithDot = '.' + mainClass;
    // Transform .book-content p -> .book-content.chapter-0 p
    return selector.replace(mainClassWithDot, `${mainClassWithDot}.chapter-${chapterIndex}`);
}

function loadVisualEditorState() {
    const scope = document.querySelector('input[name="ve-scope"]:checked').value;
    const chapterIndex = document.getElementById('chapter-select').value;
    const baseSelector = document.getElementById('ve-selector').value;
    const selector = scope === 'global' ? baseSelector : getChapterSpecificSelector(baseSelector, chapterIndex);

    // Always parse the raw CSS to get latest
    parseRawCSS();
    let rules = parsedCSS[selector] || {};

    // 3. Populate visual fields
    document.getElementById('ve-font-family').value = rules['font-family'] || '';
    document.getElementById('ve-font-size').value = rules['font-size'] || '';
    document.getElementById('ve-text-align').value = rules['text-align'] || '';

    // Handle Text Color
    const color = rules['color'] || '';
    document.getElementById('ve-color').value = color;
    document.getElementById('ve-color-picker').value = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#000000';

    // Handle Background Color
    const bg = rules['background-color'] || '';
    document.getElementById('ve-bg').value = bg;
    document.getElementById('ve-bg-picker').value = /^#[0-9A-Fa-f]{6}$/.test(bg) ? bg : '#000000';

    // 4. Disable text-align for inline elements based on baseSelector
    const textAlignSelect = document.getElementById('ve-text-align');
    const inlineSelectors = ['.book-content strong', '.book-content em', '.book-content pre code'];
    if (inlineSelectors.includes(baseSelector)) {
        textAlignSelect.disabled = true;
        textAlignSelect.title = "Text-align not applicable for inline elements";
    } else {
        textAlignSelect.disabled = false;
        textAlignSelect.title = "";
    }
}

function applyVisualEditorState() {
    // Parse current CSS editor content to get latest state
    parseRawCSS();

    const baseSelector = document.getElementById('ve-selector').value;
    const scope = document.querySelector('input[name="ve-scope"]:checked').value;
    const chapterIndex = document.getElementById('chapter-select').value;

    const selector = scope === 'global' ? baseSelector : getChapterSpecificSelector(baseSelector, chapterIndex);

    if (!parsedCSS[selector]) parsedCSS[selector] = {};

    // Helper to extract value and save/delete from state
    const updateProp = (prop, valId) => {
        const val = document.getElementById(valId).value.trim();
        if (val) parsedCSS[selector][prop] = val;
        else delete parsedCSS[selector][prop];
    };

    updateProp('font-family', 've-font-family');
    updateProp('font-size', 've-font-size');
    updateProp('color', 've-color');
    updateProp('background-color', 've-bg');
    updateProp('text-align', 've-text-align');

    // Compile object back to string, update raw box, and refresh preview
    serializeCSS();
    updatePreview();

    // --- NEW: Push visual edit to history ---
    pushHistory(document.getElementById("css-editor").value);
}

function applyQuickCenter() {
    const mainClass = document.getElementById('class-input').value.trim() || 'book-content';
    const scope = document.querySelector('input[name="centering-scope"]:checked').value;
    let cssRules = [];

    // Check each checkbox and generate CSS rules
    if (document.getElementById('center-headings').checked) {
        cssRules.push(`${mainClass} h1, ${mainClass} h2, ${mainClass} h3 { text-align: center; }`);
    }
    if (document.getElementById('center-paragraphs').checked) {
        cssRules.push(`${mainClass} p { text-align: center; }`);
    }
    if (document.getElementById('center-images').checked) {
        cssRules.push(`${mainClass} img { display: block; margin: 0 auto; }`);
    }
    if (document.getElementById('center-blockquotes').checked) {
        cssRules.push(`${mainClass} blockquote { text-align: center; }`);
    }

    const rulesText = cssRules.join('\n');

    if (scope === 'global') {
        // Add new rules to existing CSS (global)
        const currentCSS = document.getElementById('css-editor').value;
        const newCSS = currentCSS + '\n\n/* Quick Centering Rules */\n' + rulesText;
        document.getElementById('css-editor').value = newCSS;
        parseRawCSS();
        updatePreview();
        pushHistory(newCSS);
    } else {
        // Save to chapter-specific settings (stored in memory, not in CSS editor)
        const chapterIndex = document.getElementById('chapter-select').value;
        chapterCenteringSettings[chapterIndex] = {
            headings: document.getElementById('center-headings').checked,
            paragraphs: document.getElementById('center-paragraphs').checked,
            images: document.getElementById('center-images').checked,
            blockquotes: document.getElementById('center-blockquotes').checked
        };
        updatePreview();
        pushHistory(document.getElementById('css-editor').value);
    }
}

function deleteChapterCenteringCSS(chapterIndex) {
    const settings = chapterCenteringSettings[chapterIndex];
    if (!settings) return;

    const mainClass = document.getElementById('class-input').value.trim() || 'book-content';
    const cssEditor = document.getElementById('css-editor');
    let currentCSS = cssEditor.value;

    // Remove the chapter-specific centering block for this chapter
    const chapterBlockRegex = new RegExp(
        `\\n\\n/\\* Chapter ${chapterIndex} Centering \\*/\\n[\\s\\S]*?(?=\\n\\n/\\*|$)`,
        'g'
    );
    currentCSS = currentCSS.replace(chapterBlockRegex, '');
    cssEditor.value = currentCSS;
    parseRawCSS();
}

function changeChapter() {
    const select = document.getElementById("chapter-select");
    const selectedIndex = select.value;

    if (projectChapters[selectedIndex]) {
        window.sampleMd = projectChapters[selectedIndex].content;

        // Load chapter-specific centering settings into checkboxes
        const centeringSettings = chapterCenteringSettings[selectedIndex];
        document.getElementById('center-headings').checked = centeringSettings?.headings || false;
        document.getElementById('center-paragraphs').checked = centeringSettings?.paragraphs || false;
        document.getElementById('center-images').checked = centeringSettings?.images || false;
        document.getElementById('center-blockquotes').checked = centeringSettings?.blockquotes || false;

        // Reload visual editor state for the new chapter
        loadVisualEditorState();
        updatePreview();
    }
}

function updatePreview() {
    const baseCSS = document.getElementById("css-editor").value;
    const mainClass = document.getElementById("class-input").value;
    const surface = document.getElementById("epub-render-surface");
    const chapterIndex = document.getElementById("chapter-select").value;
    const scope = document.querySelector('input[name="ve-scope"]:checked').value;

    // Build combined CSS: base + chapter-specific centering
    let combinedCSS = baseCSS;
    const chapterSettings = chapterCenteringSettings[chapterIndex];
    if (chapterSettings) {
        const chapterCSS = generateChapterCenteringCSS(chapterSettings, mainClass);
        if (chapterCSS) {
            combinedCSS += '\n\n/* Chapter ' + chapterIndex + ' Centering */\n' + chapterCSS;
        }
    }

    const styleTag = document.getElementById("live-css");
    if (styleTag) styleTag.innerHTML = combinedCSS;

    // Set surface class with chapter-specific class when in chapter mode
    if (scope === 'chapter') {
        surface.className = `${mainClass} chapter-${chapterIndex}`;
    } else {
        surface.className = mainClass;
    }

    if (window.sampleMd) {
        let md = window.sampleMd;
        md = md.replace(/!\[\[(.*?)\]\]/g, '![obsidian-image](/project-assets/images/$1)');
        md = md.replace(/!\[(.*?)\]\(((?!http|data:).*?)\)/g, '![$1](/project-assets/$2)');
        surface.innerHTML = marked.parse(md);
    }
}

function generateChapterCenteringCSS(settings, mainClass) {
    const rules = [];
    if (settings.headings) {
        rules.push(`${mainClass} h1, ${mainClass} h2, ${mainClass} h3 { text-align: center; }`);
    }
    if (settings.paragraphs) {
        rules.push(`${mainClass} p { text-align: center; }`);
    }
    if (settings.images) {
        rules.push(`${mainClass} img { display: block; margin: 0 auto; }`);
    }
    if (settings.blockquotes) {
        rules.push(`${mainClass} blockquote { text-align: center; }`);
    }
    return rules.join('\n');
}

async function compile() {
    const btn = document.getElementById("compile-btn");
    const originalText = btn.innerText;
    btn.innerText = "⌛ Compiling...";

    // 1. Capture the original namespaced CSS
    const originalCSS = document.getElementById("css-editor").value;

    try {
        const mainClass = document.getElementById("class-input").value.trim() || "book-content";
        let pandocCSS = originalCSS;

        // 2. Strip the namespace so Pandoc can apply styles to standard HTML tags
        if (mainClass) {
            // Converts ".book-content em {" to "em {"
            const childrenRegex = new RegExp(`\\.${mainClass}\\s+`, 'g');
            // Converts ".book-content {" to "body {"
            const rootRegex = new RegExp(`\\.${mainClass}\\s*\\{`, 'g');

            pandocCSS = pandocCSS.replace(childrenRegex, '');
            pandocCSS = pandocCSS.replace(rootRegex, 'body {');
        }

        // 3. Temporarily save the CLEANED CSS to disk for Pandoc to use
        await fetch("/save-css", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ css: pandocCSS }),
        });

        // 4. Run Pandoc
        const res = await fetch("/compile", { method: "POST" });
        const data = await res.json();

        if (res.status === 404) {
            document.getElementById('path-modal').style.display = 'flex';
        } else if (!res.ok) {
            alert("Error:\n\n" + (data.error || "Unknown error"));
        } else {
            alert(data.message);
        }
    } catch (e) {
        console.error(e); // Helpful for debugging
        alert("Server connection error.");
    } finally {
        // 5. ALWAYS restore the original namespaced CSS on the server
        // so your live editor stays in sync and doesn't break
        await fetch("/save-css", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ css: originalCSS }),
        });
        btn.innerText = originalText;
    }
}

async function savePandocPath() {
    const pathInput = document.getElementById('manual-pandoc-path');
    const path = pathInput.value.trim();
    if (!path) return;

    await fetch('/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
    });

    document.getElementById('path-modal').style.display = 'none';
    compile();
}

async function exitApp() {
    if (confirm("This will stop the server and close the editor. Continue?")) {
        try {
            // Tell the server to shut down
            fetch("/exit", { method: "POST" });

            // Try to close the window
            window.close();

            // Fallback for browsers that block window.close()
            setTimeout(() => {
                document.body.innerHTML = "<div style='color:white;text-align:center;margin-top:20%;font-family:sans-serif;'><h1>Server Closed</h1><p>You can now close this tab.</p></div>";
            }, 100);
        } catch (e) {
            console.error("Exit failed", e);
        }
    }
}

async function checkPandocOnLoad() {
    try {
        const res = await fetch('/check-pandoc');
        const data = await res.json();

        const modal = document.getElementById('path-modal');
        if (data.found) {
            // If the server found Pandoc, hide the dialog immediately
            modal.style.display = 'none';
            console.log("Pandoc verified at startup:", data.path);
        } else {
            // If not found, ensure the dialog is visible
            modal.style.display = 'flex';
        }
    } catch (e) {
        console.error("Could not reach server to check Pandoc status.");
    }
}

// --- NEW: History Stack & Save Logic ---

function pushHistory(css) {
    if (isHistoryNavigation) return; // Don't record undos as new events
    if (historyIndex >= 0 && cssHistory[historyIndex] === css) return; // Prevent duplicates

    // If we undo'd and then typed something new, erase the "future" history
    cssHistory = cssHistory.slice(0, historyIndex + 1);
    cssHistory.push(css);
    historyIndex++;
}

function undoCSS() {
    if (historyIndex > 0) {
        historyIndex--;
        applyHistoryState();
    }
}

function redoCSS() {
    if (historyIndex < cssHistory.length - 1) {
        historyIndex++;
        applyHistoryState();
    }
}

function applyHistoryState() {
    isHistoryNavigation = true; // Lock history pushing temporarily
    const css = cssHistory[historyIndex];
    document.getElementById("css-editor").value = css;

    // Resync everything with the undone/redone CSS
    parseRawCSS();
    loadVisualEditorState();
    updatePreview();

    isHistoryNavigation = false;
}

function handleRawCSSTyping() {
    const css = document.getElementById("css-editor").value;

    // Debounce the typing so we don't save a history state for every single letter
    clearTimeout(historyTimeout);
    historyTimeout = setTimeout(() => {
        pushHistory(css);
    }, 500);

    updatePreview();
    loadVisualEditorState();
}

async function saveCSS() {
    if (!projectLoaded) return;

    const css = document.getElementById("css-editor").value;
    const btn = document.getElementById("save-css-btn");
    const originalText = btn.innerText;

    btn.innerText = "⌛ Saving...";

    try {
        await fetch("/save-css", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ css }),
        });

        // Show success briefly
        btn.innerText = "✅ Saved!";
        setTimeout(() => { btn.innerText = originalText; }, 2000);
    } catch (e) {
        console.error("Save Error:", e);
        alert("Failed to save CSS to disk.");
        btn.innerText = originalText;
    }
}

// Execute the check as soon as the page loads
checkPandocOnLoad();