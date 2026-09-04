import crypto from "node:crypto";
import { spawn } from "node:child_process";
const npm=process.platform==='win32'?'npm.cmd':'npm';const node=process.execPath;const token=crypto.randomBytes(32).toString('hex');const env={...process.env,FLEXLAB_MANAGEMENT_TOKEN:token,VITE_FLEXLAB_MANAGEMENT_TOKEN:token};const native=spawn(node,['native/server.mjs'],{stdio:'inherit',env});const vite=spawn(npm,['run','dev'],{stdio:'inherit',env});const stop=()=>{native.kill();vite.kill();};process.on('SIGINT',stop);process.on('SIGTERM',stop);vite.on('exit',code=>{native.kill();process.exit(code??0);});
