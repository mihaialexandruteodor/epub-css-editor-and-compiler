let projectLoaded = false;

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
    window.sampleMd = data.sampleMd;
    projectLoaded = true;
    updatePreview();
}

function updatePreview() {
    const css = document.getElementById("css-editor").value;
    const mainClass = document.getElementById("class-input").value;
    const surface = document.getElementById("epub-render-surface");

    // Update the live style tag and wrap the preview in the chosen class
    const styleTag = document.getElementById("live-css");
    if (styleTag) styleTag.innerHTML = css;
    
    surface.className = mainClass;
    if (window.sampleMd) surface.innerHTML = marked.parse(window.sampleMd);

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
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ path })
    });
    
    document.getElementById('path-modal').style.display = 'none';
    compile(); // Retry compilation with new path
}