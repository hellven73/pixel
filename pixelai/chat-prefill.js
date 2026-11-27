export async function prefillChat(model,runtime,input,onProgress) {
  const values=input.input_ids.tolist()[0].map(BigInt);
  if (values.length<=256) return null;
  let cache=null;
  const total=values.length-1;
  try {
    for (let from=0;from<total;from+=256) {
      const to=Math.min(from+256,total);
      const chunk=new runtime.Tensor('int64',values.slice(from,to),[1,to-from]);
      const mask=runtime.ones([1,to]);
      let output;
      try {
        output=await model.forward({input_ids:chunk,attention_mask:mask,past_key_values:cache});
      } finally {
        chunk.dispose();mask.dispose();
      }
      const state={};
      for (const [name,tensor] of Object.entries(output)) {
        if (name.startsWith('present_conv')) state[name.replace('present_conv','past_conv')]=tensor;
        else if (name.startsWith('present.')) state[name.replace('present.','past_key_values.')]=tensor;
        else tensor?.dispose?.();
      }
      if (!Object.keys(state).length) throw Error('Could not prepare the conversation history.');
      if (cache) cache.update(state);
      else cache=new runtime.DynamicCache(state);
      onProgress(to,total);
    }
    return cache;
  } catch (error) {
    if (cache) await cache.dispose();
    throw error;
  }
}
