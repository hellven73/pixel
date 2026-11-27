let database;
const temporaryImages=new Map();

function imageDatabase() {
  database??=new Promise((resolve,reject)=>{
    const request=indexedDB.open('pixelai-images',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('images');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  }).catch(error=>{database=undefined;throw error;});
  return database;
}

export async function storeImage(blob,temporary=false) {
  const id=crypto.randomUUID();
  if (temporary) {temporaryImages.set(id,blob);return id;}
  const db=await imageDatabase();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('images','readwrite');
    tx.objectStore('images').put(blob,id);
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error);
  });
  return id;
}

export async function readImage(id) {
  if (temporaryImages.has(id)) return temporaryImages.get(id);
  const db=await imageDatabase();
  return new Promise((resolve,reject)=>{
    const request=db.transaction('images').objectStore('images').get(id);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

export async function imageAttachment(file,temporary=false) {
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size>15000000) {
    throw Error('Choose a JPG, PNG, WebP or GIF under 15 MB.');
  }
  const bitmap=await createImageBitmap(file);
  try {
    const scale=Math.min(1,768/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d',{alpha:false});
    context.fillStyle='#fff';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.84));
    if (!blob) throw Error('The image could not be read.');
    return {name:file.name.slice(0,90),image:await storeImage(blob,temporary)};
  } finally {bitmap.close();}
}

export async function showImage(img,id) {
  const blob=await readImage(id);
  if (!blob || !img.isConnected) return;
  const url=URL.createObjectURL(blob);
  const release=()=>URL.revokeObjectURL(url);
  img.addEventListener('load',release,{once:true});
  img.addEventListener('error',release,{once:true});
  img.src=url;
}
