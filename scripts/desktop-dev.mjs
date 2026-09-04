import { spawn } from "node:child_process";
const npm=process.platform==='win32'?'npm.cmd':'npm';const electron=process.platform==='win32'?'node_modules\\.bin\\electron.cmd':'node_modules/.bin/electron';
const vite=spawn(npm,['run','dev'],{stdio:'inherit'});await new Promise(r=>setTimeout(r,1200));const app=spawn(electron,['.'],{stdio:'inherit',env:{...process.env,FLEXLAB_DEV_URL:'http://127.0.0.1:8080'}});
const stop=()=>{vite.kill();app.kill();};process.on('SIGINT',stop);process.on('SIGTERM',stop);app.on('exit',code=>{vite.kill();process.exit(code??0);});
