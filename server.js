const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const dialog = require('node-file-dialog'); // Triggers native OS picker
const os = require('os');
const ini = require('ini'); // Used for saving the Pandoc path

const app = express();
app.use(express.json());
app.use(express.static('.'));

const CONFIG_PATH = path.join(__dirname, 'config.ini');
let currentProjectPath = '';

const { execSync } = require('child_process');

async function pickFolderMac() {
    // This AppleScript triggers the native macOS folder picker
    const script = `osascript -e 'POSIX path of (choose folder with prompt "Select your Project Folder")'`;
    try {
        const stdout = execSync(script).toString().trim();
        return [stdout];
    } catch (err) {
        return []; // User cancelled
    }
}

// --- HELPER: Get Pandoc Path ---
function getPandocPath() {
    if (fs.existsSync(CONFIG_PATH)) {
        const config = ini.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        if (config.settings && config.settings.pandoc_path) {
            return config.settings.pandoc_path;
        }
    }
    return 'pandoc'; // Default if no config exists
}

// --- ROUTE: Save Custom Pandoc Path ---
app.post('/save-config', (req, res) => {
    const config = { settings: { pandoc_path: req.body.path } };
    fs.writeFileSync(CONFIG_PATH, ini.stringify(config));
    res.json({ status: 'Path saved!' });
});

// 1. Trigger Native Folder Picker
app.get('/pick-folder', async (req, res) => {
    try {
        let dir = [];
        if (process.platform === 'darwin') {
            // macOS path
            dir = await pickFolderMac();
        } else {
            // Windows/Linux path
            const config = { type: 'directory' };
            dir = await dialog(config);
        }

        if (dir && dir.length > 0) {
            currentProjectPath = dir[0].trim();
            res.json({ path: currentProjectPath });
        } else {
            res.status(400).send("Folder selection cancelled.");
        }
    } catch (err) {
        console.error("Picker Error:", err);
        res.status(500).send("Folder selection failed.");
    }
});

// 2. Load Project Data (CSS + First Chapter)
app.get('/load-project', (req, res) => {
    if (!currentProjectPath) return res.status(400).send("No project selected");

    try {
        const cssPath = path.join(currentProjectPath, 'styles', 'epub-styles.css');
        const chaptersDir = path.join(currentProjectPath, 'Chapters');

        const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '/* New Stylesheet */';

        // Filter out non-markdown and hidden files
        const files = fs.readdirSync(chaptersDir).filter(f => f.endsWith('.md') && !f.startsWith('.'));

        if (files.length === 0) throw new Error("No .md files found in Chapters folder");

        const sampleMd = fs.readFileSync(path.join(chaptersDir, files[0]), 'utf8');

        res.json({
            css,
            sampleMd,
            projectName: path.basename(currentProjectPath)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(`Error: ${err.message}`);
    }
});

// 3. Save CSS
app.post('/save-css', (req, res) => {
    const cssPath = path.join(currentProjectPath, 'styles', 'epub-styles.css');
    fs.writeFileSync(cssPath, req.body.css);
    res.send({ status: 'Saved' });
});

// 4. Run Pandoc (Using PowerShell for NAS Compatibility)
app.post('/compile', (req, res) => {
    if (!currentProjectPath) return res.status(400).send("No project selected");

    const isWin = process.platform === 'win32';
    const homeDir = os.homedir();
    const bookName = path.basename(currentProjectPath);
    const downloadPath = path.join(homeDir, 'Downloads', `${bookName}.epub`);

    // 1. Get all Markdown files
    const chaptersDir = path.join(currentProjectPath, 'Chapters');
    const chapterFiles = fs.readdirSync(chaptersDir)
        .filter(f => f.endsWith('.md'))
        .map(f => `"${path.join(chaptersDir, f)}"`)
        .join(' ');

    // 2. Define absolute paths
    const metadataPath = `"${path.join(currentProjectPath, 'metadata', 'book-info.json')}"`;
    const coverPath = `"${path.join(currentProjectPath, 'images', 'COVER.png')}"`;
    const cssPath = `"${path.join(currentProjectPath, 'styles', 'epub-styles.css')}"`;
    const outputPath = `"${downloadPath}"`;
    const resourcePath = `"${currentProjectPath}"`;

    const pandocExec = getPandocPath();

    // 3. Handle Cross-Platform Syntax
    // Windows/PowerShell needs the '&' call operator; Mac/Linux does not.
    const shellToUse = isWin ? 'powershell.exe' : '/bin/zsh';
    const cmdPrefix = isWin ? '& ' : '';

    const command = `${cmdPrefix}"${pandocExec}" ${chapterFiles} -f markdown -t epub3 --split-level=1 --metadata-file=${metadataPath} --epub-cover-image=${coverPath} --css=${cssPath} --resource-path=${resourcePath} -o ${outputPath}`;

    console.log(`Executing on ${process.platform}: ${command}`);

    exec(command, { shell: shellToUse }, (error, stdout, stderr) => {
        if (error) {
            const errorText = (stderr || "") + (error.message || "");
            // Mac usually says "command not found" if Pandoc is missing
            const isNotFound = errorText.includes("is not recognized") ||
                errorText.includes("The term") ||
                errorText.includes("command not found");

            return res.status(isNotFound ? 404 : 500).json({
                error: stderr || error.message,
                type: isNotFound ? 'PANDOC_NOT_FOUND' : 'COMPILE_ERROR'
            });
        }
        res.json({ message: `Success! Compiled to: ${downloadPath}` });
    });
});
app.listen(3000, () => console.log('Editor: http://localhost:3000'));