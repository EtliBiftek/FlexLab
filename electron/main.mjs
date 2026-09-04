import { app, BrowserWindow, Menu, Tray, nativeImage, utilityProcess, ipcMain, shell } from "electron";
import crypto from "node:crypto";
import { autoUpdater } from "electron-updater";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
let mainWindow=null, tray=null, daemon=null, quitting=false;
const managementToken=crypto.randomBytes(32).toString("hex");
process.env.FLEXLAB_MANAGEMENT_TOKEN=managementToken;
const gotLock=app.requestSingleInstanceLock();if(!gotLock)app.quit();
app.on("second-instance",()=>{if(mainWindow){mainWindow.show();mainWindow.focus();}});
function startDaemon(){if(daemon)return;const serverPath=app.isPackaged?path.join(process.resourcesPath,"app.asar.unpacked","native","server.mjs"):path.join(__dirname,"..","native","server.mjs");daemon=utilityProcess.fork(serverPath,[],{serviceName:"FlexLab Native Runtime",stdio:"pipe",env:{...process.env,FLEXLAB_MANAGEMENT_TOKEN:managementToken}});daemon.stdout?.on("data",d=>console.log(`[FlexLab native] ${d}`));daemon.stderr?.on("data",d=>console.error(`[FlexLab native] ${d}`));daemon.on("exit",()=>{daemon=null;});}
function stopDaemon(){daemon?.kill();daemon=null;}
function createWindow(){mainWindow=new BrowserWindow({width:1280,height:820,minWidth:960,minHeight:640,show:false,backgroundColor:"#0b0b0d",title:"FlexLab",webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});mainWindow.setMenuBarVisibility(false);const dev=process.env.FLEXLAB_DEV_URL;if(dev)mainWindow.loadURL(dev);else mainWindow.loadFile(path.join(__dirname,"..","dist","index.html"));mainWindow.once("ready-to-show",()=>mainWindow?.show());mainWindow.on("close",e=>{if(!quitting){e.preventDefault();mainWindow.hide();}});mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/i.test(url))void shell.openExternal(url);return{action:"deny"};});}
function createTray(){const iconPath=path.join(__dirname,"..","build","icon.png");let image=nativeImage.createFromPath(iconPath);if(image.isEmpty())image=nativeImage.createEmpty();tray=new Tray(image.resize({width:18,height:18}));tray.setToolTip("FlexLab");tray.setContextMenu(Menu.buildFromTemplate([{label:"FlexLab'ı aç",click:()=>{mainWindow?.show();mainWindow?.focus();}},{type:"separator"},{label:"Çık",click:()=>{quitting=true;app.quit();}}]));tray.on("double-click",()=>mainWindow?.show());}
ipcMain.handle("desktop:get",()=>({version:app.getVersion(),openAtLogin:app.getLoginItemSettings().openAtLogin,packaged:app.isPackaged}));
ipcMain.handle("desktop:set-open-at-login",(_e,enabled)=>{app.setLoginItemSettings({openAtLogin:Boolean(enabled)});return app.getLoginItemSettings().openAtLogin;});
ipcMain.handle("desktop:check-updates",async()=>{if(!app.isPackaged)return{ok:false,message:"Dev build"};const r=await autoUpdater.checkForUpdates();return{ok:true,version:r?.updateInfo?.version||null};});
app.whenReady().then(()=>{app.setAppUserModelId("com.pifo.flexlab");startDaemon();createWindow();createTray();if(app.isPackaged)setTimeout(()=>autoUpdater.checkForUpdatesAndNotify().catch(()=>{}),5000);});
app.on("before-quit",()=>{quitting=true;stopDaemon();});app.on("window-all-closed",()=>{});
