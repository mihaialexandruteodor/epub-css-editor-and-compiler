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

    try {
        // 1. Get the latest CSS from the editor
        const currentCSS = document.getElementById("css-editor").value;

        // 2. Force the server to write the file to disk and wait for it to finish
        await fetch("/save-css", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ css: currentCSS }),
        });

        // 3. Now it is safe to run Pandoc
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
        btn.innerText = originalText;
    }
}

async function savePandocPath() {
    // (Unchanged pandoc save logic...)
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