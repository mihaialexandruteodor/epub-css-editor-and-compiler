const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require("path");

// Force correct working directory when launched from shortcut
process.chdir(__dirname);


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

async function pickFolderWindows() {
    // We use -NoProfile to ignore the broken PowerShell profile error
    // We use [void] and Out-Null to ensure NO booleans (True/False) leak out
    const script = `
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $sig = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);'
    Add-Type -MemberDefinition $sig -Name "Win32" -Namespace "Util" | Out-Null

    $f = New-Object System.Windows.Forms.Form
    $f.Text = "Select Project Folder"
    $f.TopMost = $true
    $f.Opacity = 0.01 
    $f.ShowInTaskbar = $true
    $f.StartPosition = "CenterScreen"

    $f.Show() | Out-Null
    [Util.Win32]::SetForegroundWindow($f.Handle) | Out-Null
    $f.Activate() | Out-Null

    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = "Folders|thumb.db"
    $dialog.ValidateNames = $false
    $dialog.CheckFileExists = $false
    $dialog.CheckPathExists = $true
    $dialog.FileName = "Select Folder"
    
    $result = $dialog.ShowDialog($f)
    $f.Close() | Out-Null

    if ($result -eq 'OK') {
        Write-Output (Split-Path -Parent $dialog.FileName)
    }
    `;

    try {
        // We call powershell.exe and pass the script via the 'input' buffer
        // This avoids command-line length limits and argument parsing issues
        const stdout = execSync('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command -', {
            input: script,
            encoding: 'utf8'
        });

        const lines = stdout.split(/[\r\n]+/);
        // Look for a line that starts with a drive letter or network path
        const pathLine = lines.find(l => l.trim().match(/^[a-zA-Z]:\\|^\\\\/));

        const cleanPath = pathLine ? pathLine.trim() : null;
        return cleanPath ? [cleanPath] : [];
    } catch (err) {
        console.error("Windows Picker Error:", err);
        return [];
    }
}

async function pickFolderLinux() {
    try {
        // --file-selection with --directory is the native GTK picker
        const stdout = execSync('zenity --file-selection --directory --title="Select Project Folder"', {
            encoding: 'utf8'
        }).trim();
        return stdout ? [stdout] : [];
    } catch (err) {
        return []; // User closed or cancelled
    }
}

// --- HELPER: Get Pandoc Path ---
function getPandocPath() {
    const isWin = process.platform === 'win32';

    if (isWin) {
        // 1. Check Local AppData (Standard user install)
        const localAppData = process.env.LOCALAPPDATA;
        const localPath = path.join(localAppData, 'Pandoc', 'pandoc.exe');
        if (fs.existsSync(localPath)) return localPath;

        // 2. Check Program Files (System-wide install)
        const programFiles = process.env.ProgramFiles;
        const systemPath = path.join(programFiles, 'Pandoc', 'pandoc.exe');
        if (fs.existsSync(systemPath)) return systemPath;
    }

    // 3. Fallback to config.ini
    if (fs.existsSync(CONFIG_PATH)) {
        const config = ini.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        if (config.settings && config.settings.pandoc_path) {
            let p = config.settings.pandoc_path;
            // Expand %vars% if they exist in the INI string
            if (isWin) {
                p = p.replace(/%([^%]+)%/g, (_, n) => process.env[n] || _);
            }
            return p;
        }
    }

    // 4. Final attempt: check if it's in the system PATH
    return 'pandoc';
}

// --- ROUTE: Save Custom Pandoc Path ---
app.post('/save-config', (req, res) => {
    try {
        if (!req.body.path) return res.status(400).json({ error: "No path provided" });

        const cleanPath = req.body.path.replace(/^"|"$/g, '').trim();
        const config = { settings: { pandoc_path: cleanPath } };

        fs.writeFileSync(CONFIG_PATH, ini.stringify(config));
        res.json({ status: 'Path saved!' });
    } catch (err) {
        console.error("Save Error:", err);
        res.status(500).json({ error: "Failed to write config file" });
    }
});

// 1. Trigger Native Folder Picker
app.get('/pick-folder', async (req, res) => {
    try {
        let dir = [];
        const platform = process.platform;

        if (platform === 'darwin') {
            dir = await pickFolderMac();
        } else if (platform === 'win32') {
            dir = await pickFolderWindows();
        } else {
            dir = await pickFolderLinux();
        }

        if (dir && dir.length > 0) {
            currentProjectPath = dir[0].trim();
            // ALWAYS return an object
            res.json({ path: currentProjectPath });
        } else {
            // Change .send() to .json() to avoid frontend parse errors
            res.status(400).json({ error: "Folder selection cancelled." });
        }
    } catch (err) {
        console.error("Picker Error:", err);
        res.status(500).json({ error: "Folder selection failed." });
    }
});

// 2. Load Project Data (CSS + Chapters)
app.get('/load-project', (req, res) => {
    if (!currentProjectPath) return res.status(400).send("No project selected");

    try {
        const cssPath = path.join(currentProjectPath, 'styles', 'epub-styles.css');
        const chaptersDir = path.join(currentProjectPath, 'Chapters');

        const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '/* New Stylesheet */';

        // Filter out non-markdown and hidden files
        const files = fs.readdirSync(chaptersDir).filter(f => f.endsWith('.md') && !f.startsWith('.'));

        if (files.length === 0) throw new Error("No .md files found in Chapters folder");

        // NEW: Map through all valid files and attach their content
        const chapters = files.map(file => ({
            name: file,
            content: fs.readFileSync(path.join(chaptersDir, file), 'utf8')
        }));

        res.json({
            css,
            chapters, // Sending the full array of chapters now
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


// 5. Serve Project Assets (Images) dynamically
app.use('/project-assets', (req, res) => {
    if (!currentProjectPath) return res.status(400).send("No project selected");

    // req.path automatically contains everything AFTER '/project-assets'
    // e.g., if the URL is '/project-assets/images/cover.png', req.path is '/images/cover.png'
    // We decode it to handle spaces in folder/file names, and strip the leading slash
    const requestedPath = decodeURIComponent(req.path).replace(/^\//, '');

    if (!requestedPath) return res.status(400).send("Invalid path");

    // Resolve relative to the Chapters folder or project root
    const resolvedFromChapters = path.resolve(currentProjectPath, 'Chapters', requestedPath);
    const resolvedFromRoot = path.resolve(currentProjectPath, requestedPath);

    if (fs.existsSync(resolvedFromChapters)) {
        res.sendFile(resolvedFromChapters);
    } else if (fs.existsSync(resolvedFromRoot)) {
        res.sendFile(resolvedFromRoot);
    } else {
        res.status(404).send("Asset not found");
    }
});

// Add this near your other routes
app.post('/exit', (req, res) => {
    console.log("Shutting down server...");
    res.json({ success: true });

    // Delay exit by 500ms to allow the response to reach the browser
    setTimeout(() => {
        process.exit(0);
    }, 500);
});

app.get('/check-pandoc', (req, res) => {
    const pandocPath = getPandocPath();
    const isWin = process.platform === 'win32';

    // Check if the file exists or is accessible via system PATH
    const exists = pandocPath === 'pandoc' || fs.existsSync(pandocPath);

    res.json({ found: exists, path: pandocPath });
});

app.listen(3000, () => console.log('Editor: http://localhost:3000'));