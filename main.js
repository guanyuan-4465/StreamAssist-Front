const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const iconv = require('iconv-lite');
const fetch = require('node-fetch');

let mainWindow = null;
let pythonProcess = null;
let startupRetries = 0;
const MAX_STARTUP_RETRIES = 3;

// 获取应用程序的根目录
function getAppPath() {
    // 在开发环境中使用当前目录，在打包环境中使用app.getAppPath()
    return app.isPackaged
        ? path.join(process.resourcesPath)
        : path.join(__dirname);
}

function createWindow() {
    if (mainWindow) {
        return;
    }

    console.log('Creating browser window...');

    // 获取应用程序路径
    const appPath = getAppPath();
    const iconPath = app.isPackaged
        ? path.join(appPath, 'autoreply', 'dist', 'favicon.ico')
        : path.join(__dirname, 'autoreply', 'dist', 'favicon.ico');

    console.log(`Using icon path: ${iconPath}`);

    // 创建浏览器窗口
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,  // 初始时不显示窗口
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false,
            devTools: true
        },
        icon: iconPath
    });

    // 窗口准备好后再显示
    mainWindow.once('ready-to-show', () => {
        console.log('Window ready to show');
        mainWindow.show();
        mainWindow.focus();
    });

    // 监听窗口关闭事件
    mainWindow.on('closed', function () {
        console.log('Window closed');
        mainWindow = null;
    });

    // 检查前端资源路径
    const frontendPath = path.join(appPath, 'autoreply', 'dist', 'index.html');
    console.log(`Checking frontend path: ${frontendPath}`);

    if (!fs.existsSync(frontendPath)) {
        console.error(`Frontend file not found: ${frontendPath}`);
        const possiblePaths = [
            path.join(appPath, 'dist', 'index.html'),
            path.join(appPath, 'autoreply', 'index.html'),
            path.join(appPath, 'index.html')
        ];

        let foundPath = null;
        for (const testPath of possiblePaths) {
            console.log(`Checking alternative path: ${testPath}`);
            if (fs.existsSync(testPath)) {
                foundPath = testPath;
                console.log(`Found frontend at: ${foundPath}`);
                break;
            }
        }

        if (foundPath) {
            loadFrontend(foundPath);
        } else {
            console.error('No frontend file found in any of the expected locations');
            showErrorPage("找不到前端资源文件。请确保前端已正确构建。");
        }
    } else {
        console.log(`Frontend file found at: ${frontendPath}`);
        loadFrontend(frontendPath);
    }
}

// 加载前端
async function loadFrontend(htmlPath) {
    console.log(`Loading frontend from: ${htmlPath}`);

    // 获取HTML文件所在的目录
    const htmlDir = path.dirname(htmlPath);
    console.log(`HTML directory: ${htmlDir}`);

    // 检查资源文件是否存在
    try {
        const files = fs.readdirSync(htmlDir);
        const jsFiles = files.filter(file => file.endsWith('.js'));
        const cssFiles = files.filter(file => file.endsWith('.css'));

        console.log(`Found JS files: ${jsFiles.join(', ')}`);
        console.log(`Found CSS files: ${cssFiles.join(', ')}`);
    } catch (err) {
        console.error(`Error reading directory: ${err.message}`);
    }

    try {
        // 创建本地服务器来提供前端资源
        const port = await createLocalServer(htmlDir);

        // 通过HTTP加载前端，而不是通过file协议
        const indexUrl = `http://localhost:${port}/index.html`;
        console.log(`Loading frontend from server: ${indexUrl}`);

        await mainWindow.loadURL(indexUrl);
        console.log('Frontend loaded successfully via HTTP');

        // 注入调试代码
        mainWindow.webContents.executeJavaScript(`
            console.log('Document title:', document.title);
            console.log('Document body:', document.body.innerHTML.substring(0, 500) + '...');

            // 检查资源是否加载
            const scripts = Array.from(document.scripts).map(s => s.src);
            const styles = Array.from(document.styleSheets).map(s => s.href);

            console.log('Loaded scripts:', scripts);
            console.log('Loaded styles:', styles);
        `).catch(err => {
            console.error('Failed to execute debug script:', err);
        });
    } catch (err) {
        console.error(`Error in loadFrontend: ${err.message}`);
        showErrorPage(`加载前端失败: ${err.message}`);
    }
}

// 创建本地服务器来提供前端资源
function createLocalServer(rootDir) {
    return new Promise((resolve) => {
        const http = require('http');
        const serveStatic = require('serve-static');
        const finalhandler = require('finalhandler');

        console.log(`Creating static file server for directory: ${rootDir}`);

        // 创建静态文件服务
        const serve = serveStatic(rootDir, {
            index: ['index.html'],
            extensions: ['html'],
            fallthrough: false  // 返回404而不是继续
        });

        // 创建服务器
        const server = http.createServer((req, res) => {
            console.log(`Server request: ${req.method} ${req.url}`);

            // 添加CORS头
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            // 处理请求
            serve(req, res, (err) => {
                if (err) {
                    console.error(`Server error: ${err.message}`);
                    res.statusCode = err.statusCode || 500;
                    res.end(err.message);
                } else {
                    finalhandler(req, res)(err);
                }
            });
        });

        // 监听随机端口
        server.listen(0, () => {
            const port = server.address().port;
            console.log(`Local server started on port ${port}`);
            resolve(port);
        });

        // 当应用关闭时关闭服务器
        app.on('will-quit', () => {
            server.close();
        });
    });
}

// 显示错误页面
function showErrorPage(errorMessage) {
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>StreamAssist - 错误</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-color: #f5f5f5;
                color: #333;
            }
            .error-container {
                text-align: center;
                padding: 30px;
                background-color: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                max-width: 80%;
            }
            h1 {
                color: #e74c3c;
            }
            .error-message {
                margin: 20px 0;
                padding: 15px;
                background-color: #f8d7da;
                border: 1px solid #f5c6cb;
                border-radius: 4px;
                color: #721c24;
                text-align: left;
                overflow-wrap: break-word;
            }
            .help-text {
                margin-top: 20px;
                font-size: 14px;
                color: #666;
            }
        </style>
    </head>
    <body>
        <div class="error-container">
            <h1>StreamAssist 启动失败</h1>
            <div class="error-message">${errorMessage}</div>
            <div class="help-text">
                <p>请检查以下内容:</p>
                <ul style="text-align: left;">
                    <li>确保前端已正确构建到 autoreply/dist 目录</li>
                    <li>确保 index.html 文件存在且可访问</li>
                    <li>检查控制台输出以获取更多信息</li>
                </ul>
            </div>
        </div>
    </body>
    </html>
    `;

    // 将错误页面写入临时文件
    const tempFile = path.join(app.getPath('temp'), 'streamassist-error.html');
    fs.writeFileSync(tempFile, htmlContent, 'utf8');

    // 加载错误页面
    mainWindow.loadURL(
        url.format({
            pathname: tempFile,
            protocol: 'file:',
            slashes: true,
        })
    );
}

// 检查后端健康状态
async function checkBackendHealth() {
    try {
        const response = await fetch('http://127.0.0.1:5000/health');
        const data = await response.json();
        return response.ok && data.status === 'healthy';
    } catch (error) {
        return false;
    }
}

// 等待后端启动
async function waitForBackend(maxAttempts = 60, interval = 1000) {
    console.log('Waiting for backend to start...');
    for (let i = 0; i < maxAttempts; i++) {
        if (await checkBackendHealth()) {
            console.log('Backend is ready!');
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
        if (i % 5 === 0) { // 每5次尝试输出一次日志
            console.log(`Waiting for backend... Attempt ${i + 1}/${maxAttempts}`);
        }
    }
    console.error('Backend failed to start in time');
    return false;
}

// 创建并运行VBS脚本来隐藏命令窗口
function createVbsScript(exePath, workingDir) {
    const vbsPath = path.join(app.getPath('temp'), 'run_hidden.vbs');
    const vbsContent = `
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "${workingDir.replace(/\\/g, '\\\\')}"
WshShell.Run Chr(34) & "${exePath.replace(/\\/g, '\\\\')}" & Chr(34), 0, False
Set WshShell = Nothing
    `.trim();
    fs.writeFileSync(vbsPath, vbsContent, { encoding: 'utf8' });
    return vbsPath;
}

// 启动Python后端
async function startPythonBackendAlt() {
    if (process.platform === 'win32') {
        // 在打包环境中使用正确的路径
        const appPath = getAppPath();
        const pythonExePath = path.join(appPath, 'dist', 'StreamAssist', 'StreamAssist.exe');
        const workingDir = path.join(appPath, 'dist', 'StreamAssist');

        console.log(`Using backend path: ${pythonExePath}`);
        console.log(`Working directory: ${workingDir}`);

        if (!fs.existsSync(pythonExePath)) {
            throw new Error(`Python executable not found: ${pythonExePath}`);
        }

        console.log(`Starting Python backend: ${pythonExePath}`);

        try {
            // 创建VBS脚本
            const vbsPath = createVbsScript(pythonExePath, workingDir);

            // 使用同步执行确保VBS脚本运行完成
            const result = require('child_process').execSync(
                `cscript //Nologo "${vbsPath}"`,
                {
                    windowsHide: true,
                    stdio: 'ignore'
                }
            );

            console.log('Backend process started');

            // 删除临时VBS脚本
            try {
                fs.unlinkSync(vbsPath);
            } catch (err) {
                console.error('Failed to delete temporary VBS script:', err);
            }

            // 创建虚拟进程对象
            pythonProcess = {
                kill: async function() {
                    return new Promise((resolve) => {
                        exec('taskkill /f /im StreamAssist.exe', (error) => {
                            if (error) {
                                console.error(`Failed to kill Python process: ${error}`);
                            } else {
                                console.log('Python process terminated');
                            }
                            resolve();
                        });
                    });
                }
            };

            // 等待后端启动
            const isReady = await waitForBackend();
            if (!isReady) {
                throw new Error('Backend failed to start in time');
            }
            return true;

        } catch (error) {
            console.error('Failed to start backend:', error);
            return false;
        }
    } else {
        return startPythonBackend();
    }
}

// 启动应用
async function startApp() {
    try {
        // 确保没有遗留的Python进程
        await new Promise((resolve) => {
            exec('taskkill /f /im StreamAssist.exe', () => resolve());
        });

        // 等待一会儿确保进程完全终止
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 先启动后端
        const backendStarted = await startPythonBackendAlt();
        if (!backendStarted) {
            if (startupRetries < MAX_STARTUP_RETRIES) {
                startupRetries++;
                console.log(`Retrying startup (${startupRetries}/${MAX_STARTUP_RETRIES})...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return startApp();
            }
            throw new Error('Backend failed to start after multiple attempts');
        }

        console.log('Backend is ready, creating window...');

        // 后端启动成功后创建窗口
        createWindow();

        console.log('Window created and initialized');
        return true;
    } catch (error) {
        console.error('Startup error:', error);
        // 确保mainWindow已创建再显示错误
        if (!mainWindow) {
            createWindow();
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        showErrorPage(`启动失败: ${error.message}`);
        return false;
    }
}

// 修改app.on('ready')处理程序
app.on('ready', async () => {
    try {
        await startApp();
    } catch (error) {
        console.error('Failed to start application:', error);
        app.quit();
    }
});

// 当所有窗口都关闭时退出应用
app.on('window-all-closed', async function () {
    if (process.platform !== 'darwin') {
        if (pythonProcess) {
            await pythonProcess.kill();
        }
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

// 修改重启后端的处理程序
ipcMain.on('restart-backend', async () => {
    if (pythonProcess) {
        pythonProcess.kill();
        // 等待旧进程完全终止
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const backendStarted = await startPythonBackendAlt();
    if (!backendStarted) {
        mainWindow.webContents.send('backend-start-failed');
    } else {
        mainWindow.webContents.send('backend-restarted');
    }
});

// 获取后端状态
ipcMain.handle('get-backend-status', () => {
    return {
        running: pythonProcess ? true : false  // 简化判断，因为在方法2中我们无法准确知道进程状态
    };
});
