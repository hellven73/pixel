const smol={repository:'HuggingFaceTB/SmolLM2-360M-Instruct',revision:'a10cc1512eabd3dde888204e902eca88bddb4951',name:'SmolLM2 360M',webgpu:'q4f16',wasm:'q4'};
const writer={repository:'onnx-community/Qwen2.5-0.5B-Instruct',revision:'22942cb7d7ba4cc81bb4673549ca4d4614469b5e',name:'Qwen2.5 0.5B',webgpu:'q4f16',wasm:'q8'};
export const localModels={
  local:{repository:'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',revision:'10f72e70abf67ac0fd7ebf15bc5854726891d864',name:'LFM2.5 1.2B',label:'On-device',description:'Conversation, follow-ups and code. Downloads about 760–855 MB. CPU replies can be slow.',webgpu:'q4f16',wasm:'q4',chunkedChat:true,weightFiles:['model']},
  advanced:{repository:'onnx-community/Qwen3.5-2B-ONNX',revision:'315216e893038beefcc6eba41ac168913dd0d879',name:'Qwen3.5 2B',label:'Advanced',description:'For coding, debugging and harder questions. Downloads about 1.4–1.6 GB. WebGPU is recommended.',webgpu:'q4f16',wasm:'q4',weightFiles:['embed_tokens','decoder_model_merged']},
  lite:{...smol,label:'On-device Lite',description:'A smaller model for quick chats. Downloads about 285–400 MB.'},
  writer:{...writer,label:'Writer',description:'Essays, articles and long drafts. Downloads about 500–530 MB.'},
  vision:{repository:'HuggingFaceTB/SmolVLM-256M-Instruct',revision:'d039ab0d4b9311b617e8ffec1d06c8464364aeb3',name:'SmolVLM 256M',label:'Vision',description:'Describe and ask questions about an uploaded image. Downloads about 190–200 MB.',webgpu:'q4f16',wasm:{embed_tokens:'q8',vision_encoder:'q4',decoder_model_merged:'q4'}},
  illustration:{...writer,label:'Illustrator',description:'Create a downloadable SVG illustration. Downloads about 500–530 MB if Writer is not cached.'}
};
