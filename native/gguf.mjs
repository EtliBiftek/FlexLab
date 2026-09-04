import fs from 'node:fs/promises';

const VALUE = { UINT8:0, INT8:1, UINT16:2, INT16:3, UINT32:4, INT32:5, FLOAT32:6, BOOL:7, STRING:8, ARRAY:9, UINT64:10, INT64:11, FLOAT64:12 };

class Reader {
  constructor(buf){ this.buf=buf; this.o=0; }
  need(n){ if(this.o+n>this.buf.length) throw new Error('GGUF metadata buffer too small'); }
  u8(){this.need(1);return this.buf.readUInt8(this.o++);} i8(){this.need(1);return this.buf.readInt8(this.o++);}
  u16(){this.need(2);const v=this.buf.readUInt16LE(this.o);this.o+=2;return v;} i16(){this.need(2);const v=this.buf.readInt16LE(this.o);this.o+=2;return v;}
  u32(){this.need(4);const v=this.buf.readUInt32LE(this.o);this.o+=4;return v;} i32(){this.need(4);const v=this.buf.readInt32LE(this.o);this.o+=4;return v;}
  f32(){this.need(4);const v=this.buf.readFloatLE(this.o);this.o+=4;return v;} f64(){this.need(8);const v=this.buf.readDoubleLE(this.o);this.o+=8;return v;}
  u64(){this.need(8);const v=this.buf.readBigUInt64LE(this.o);this.o+=8;return v;} i64(){this.need(8);const v=this.buf.readBigInt64LE(this.o);this.o+=8;return v;}
  str(){ const n=Number(this.u64()); this.need(n); const s=this.buf.toString('utf8',this.o,this.o+n); this.o+=n; return s; }
}
function value(r,type,depth=0){
  if(depth>3) throw new Error('GGUF nested array too deep');
  switch(type){
    case VALUE.UINT8:return r.u8(); case VALUE.INT8:return r.i8(); case VALUE.UINT16:return r.u16(); case VALUE.INT16:return r.i16();
    case VALUE.UINT32:return r.u32(); case VALUE.INT32:return r.i32(); case VALUE.FLOAT32:return r.f32(); case VALUE.BOOL:return Boolean(r.u8()); case VALUE.STRING:return r.str();
    case VALUE.UINT64:return Number(r.u64()); case VALUE.INT64:return Number(r.i64()); case VALUE.FLOAT64:return r.f64();
    case VALUE.ARRAY:{ const inner=r.u32(); const count=Number(r.u64()); const out=[]; const keep=count<=256; for(let i=0;i<count;i++){const v=value(r,inner,depth+1); if(keep)out.push(v);} return keep?out:{length:count,type:inner}; }
    default: throw new Error(`Unknown GGUF metadata value type ${type}`);
  }
}
export async function readGgufMetadata(file, maxBytes=32*1024*1024){
  const fh=await fs.open(file,'r');
  try{
    const st=await fh.stat(); const len=Math.min(st.size,maxBytes); const buf=Buffer.allocUnsafe(len); const {bytesRead}=await fh.read(buf,0,len,0); const r=new Reader(buf.subarray(0,bytesRead));
    if(r.buf.toString('ascii',0,4)!=='GGUF') throw new Error('Not a GGUF file'); r.o=4;
    const version=r.u32(); const tensorCount=Number(r.u64()); const metadataCount=Number(r.u64()); const metadata={};
    for(let i=0;i<metadataCount;i++){ const key=r.str(); const type=r.u32(); metadata[key]=value(r,type); }
    return {version,tensorCount,metadata};
  } finally { await fh.close(); }
}
function first(meta, keys){ for(const k of keys) if(meta[k]!==undefined) return meta[k]; }
export function capabilitiesFromMetadata(metadata={}){
  const architecture=String(first(metadata,['general.architecture'])||'');
  const name=String(first(metadata,['general.name'])||'');
  const context=Number(first(metadata,[`${architecture}.context_length`,'llama.context_length','qwen2.context_length','gemma3.context_length'])||0)||undefined;
  const embeddingLength=Number(first(metadata,[`${architecture}.embedding_length`,'llama.embedding_length'])||0)||undefined;
  const blockCount=Number(first(metadata,[`${architecture}.block_count`,'llama.block_count','qwen2.block_count','gemma3.block_count'])||0)||undefined;
  const template=String(first(metadata,['tokenizer.chat_template'])||'');
  const joined=`${architecture} ${name} ${template}`.toLowerCase();
  const vision=/vision|vlm|llava|qwen.*vl|gemma3|minicpm-v|pixtral/.test(joined);
  const think=/think|reasoning|deepseek-r1|qwen3|gpt-oss|seed-oss/.test(joined) || /<think>|enable_thinking|reasoning_effort/.test(template);
  const thinkLevels=/reasoning_effort|gpt-oss|seed-oss/.test(joined);
  const embedding=/bert|nomic-bert|embedding|bge|e5/.test(joined) && !template;
  return {architecture,name,context,embeddingLength,blockCount,vision,think,thinkLevels,embedding,metadata};
}
