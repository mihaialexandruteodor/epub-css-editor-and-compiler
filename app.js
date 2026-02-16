let projectLoaded = false;
let projectChapters = [];

// --- NEW: CSS Parser State ---
let parsedCSS = {};

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

function loadVisualEditorState() {
    // 1. Parse whatever is currently in the Raw CSS box
    parseRawCSS();

    // 2. See what element the user is trying to style visually
    const selector = document.getElementById('ve-selector').value;
    const rules = parsedCSS[selector] || {};

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
}

function applyVisualEditorState() {
    const selector = document.getElementById('ve-selector').value;
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
}

function changeChapter() {
    const select = document.getElementById("chapter-select");
    const selectedIndex = select.value;

    if (projectChapters[selectedIndex]) {
        window.sampleMd = projectChapters[selectedIndex].content;
        updatePreview();
    }
}

function updatePreview() {
    const css = document.getElementById("css-editor").value;
    const mainClass = document.getElementById("class-input").value;
    const surface = document.getElementById("epub-render-surface");

    const styleTag = document.getElementById("live-css");
    if (styleTag) styleTag.innerHTML = css;

    surface.className = mainClass;

    if (window.sampleMd) {
        let md = window.sampleMd;
        md = md.replace(/!\[\[(.*?)\]\]/g, '![obsidian-image](/project-assets/images/$1)');
        md = md.replace(/!\[(.*?)\]\(((?!http|data:).*?)\)/g, '![$1](/project-assets/$2)');
        surface.innerHTML = marked.parse(md);
    }

    if (projectLoaded) {
        fetch("/save-css", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ css }),
        });
    }
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

// Execute the check as soon as the page loads
checkPandocOnLoad();