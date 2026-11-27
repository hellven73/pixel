const cacheName='pixelai-local-model-v1';
const weightName=/\/onnx\/([a-z0-9_]+\.onnx)(?:\?|$)/;
const optional=promise=>promise.catch(()=>null);

async function browserCache() {
  return globalThis.caches?optional(caches.open(cacheName)):null;
}

async function originStorage() {
  return navigator.storage?.getDirectory?optional(navigator.storage.getDirectory()):null;
}

function weightFile(key) {
  const revision=key.match(/\/resolve\/([a-f0-9]{40})\//)?.[1];
  const name=key.match(weightName)?.[1];
  return revision&&name?revision+'-'+name:null;
}

export async function modelStorage() {
  const [cache,root]=await Promise.all([browserCache(),originStorage()]);
  const directory=root&&globalThis.FileSystemFileHandle?.prototype.createWritable
    ?await optional(root.getDirectoryHandle(cacheName,{create:true})):null;
  if (!cache&&!directory) return null;

  return {
    async match(key) {
      const name=directory&&weightFile(key);
      if (name) {
        const handle=await optional(directory.getFileHandle(name));
        const file=handle?await optional(handle.getFile()):null;
        if (file?.size) return new Response(file,{headers:{'Content-Length':String(file.size)}});
      }
      return cache?.match(key);
    },
    async put(key,response) {
      const name=directory&&weightFile(key);
      if (name && response.body) {
        const handle=await directory.getFileHandle(name,{create:true});
        const stream=await handle.createWritable();
        await response.body.pipeTo(stream);
      } else if (cache) {
        await cache.put(key,response);
      }
    }
  };
}

export async function clearModelStorage() {
  const root=await originStorage();
  await Promise.all([
    globalThis.caches&&caches.delete(cacheName),
    root?.removeEntry(cacheName,{recursive:true}).catch(error=>{
      if (error.name!=='NotFoundError') throw error;
    })
  ]);
}
