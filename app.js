let projectLoaded = false;
let projectChapters = []; // NEW: Array to store loaded chapters

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

    // NEW: Handle chapters array and populate the dropdown
    projectChapters = data.chapters;
    const select = document.getElementById("chapter-select");
    select.innerHTML = ''; // Clear out old options

    projectChapters.forEach((chapter, index) => {
        const opt = document.createElement("option");
        opt.value = index;
        opt.innerText = chapter.name;
        select.appendChild(opt);
    });

    // Set the initial markdown to the first chapter in the array
    window.sampleMd = projectChapters.length > 0 ? projectChapters[0].content : '';

    projectLoaded = true;
    updatePreview();
}

// NEW: Function triggered when dropdown is changed
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

    // Update the live style tag
    const styleTag = document.getElementById("live-css");
    if (styleTag) styleTag.innerHTML = css;

    surface.className = mainClass;

    if (window.sampleMd) {
        let md = window.sampleMd;

        // 1. Convert Obsidian wikilink images ![[image.png]] to standard markdown
        // Assuming your attachments are in an 'images' folder based on your compile logic
        md = md.replace(/!\[\[(.*?)\]\]/g, '![obsidian-image](/project-assets/images/$1)');

        // 2. Catch standard markdown images ![alt](path) and point them to our server route
        // The negative lookahead (?!http|data:) ensures we don't accidentally break web URLs or base64 data
        md = md.replace(/!\[(.*?)\]\(((?!http|data:).*?)\)/g, '![$1](/project-assets/$2)');

        surface.innerHTML = marked.parse(md);
    }

    // Auto-save CSS to your NAS/Local folder
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
        alert("Server connection error.");
    } finally {
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
    compile(); // Retry compilation with new path
}