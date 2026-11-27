const wiki='https://en.wikipedia.org';
const brawl=/\bbrawl(?:\s+stars)?\b/i;
const officialBrawl={title:'Brawl Stars · Supercell',url:'https://supercell.com/brawlstars/en/',extract:'Supercell identifies the playable characters in Brawl Stars as Brawlers.'};

export function lookupRequest(text,messages,enabled) {
  const namesBrawl=/\bbrawl stars\b|\bin brawl\b|\bplay brawl\b|^brawl[.!?]?$/i.test(text);
  const followUp=/\bbrawlers?\b|\b(?:characters?|roster|mario|sonic)\b/i.test(text);
  const previousBrawl=messages.slice(-5,-1).some(message=>message.role==='user'&&brawl.test(message.content));
  if (namesBrawl||(followUp&&previousBrawl)) {
    const correction=followUp&&/\b(?:there (?:is|are) no|(?:doesn't|does not|don't|do not) (?:have|feature|include)|(?:isn't|aren't|is not|are not) (?:in|playable)|that's (?:wrong|not true))\b/i.test(text);
    return {query:'Brawl Stars',topic:'Brawl Stars',official:officialBrawl,correction};
  }
  const explicit=/^(?:please\s+)?(?:search(?: wikipedia| the web| online)?(?: for)?|look up|look online for)\b\s*[:\-]?\s*/i;
  if (!enabled&&!explicit.test(text)) return null;
  const query=text.trim().replace(explicit,'').replace(/^(?:what|who|where|when) (?:is|was|are|were)\s+/i,'').replace(/[?.!]+$/,'').trim().slice(0,240);
  return query?{query}:null;
}

export async function searchWikipedia({query,topic},{signal,fetchPage=fetch}={}) {
  const url=new URL('/w/api.php',wiki);
  url.search=new URLSearchParams({
    origin:'*',format:'json',formatversion:'2',action:'query',generator:'search',
    gsrsearch:query,gsrlimit:'3',prop:'extracts',exintro:'1',explaintext:'1',exchars:'720'
  });
  const response=await fetchPage(url,{credentials:'omit',signal});
  if (!response.ok) throw Error('Wikipedia search failed.');
  const data=await response.json();
  if (data.error) throw Error('Wikipedia search failed.');
  return (data.query?.pages||[]).filter(page=>Number.isSafeInteger(page.pageid)&&
    typeof page.title==='string'&&typeof page.extract==='string'&&page.extract.trim()&&(!topic||page.title===topic))
    .sort((a,b)=>a.index-b.index)
    .map(page=>({title:page.title.slice(0,140)+' · Wikipedia',url:wiki+'/?curid='+page.pageid,extract:page.extract.trim().slice(0,720)}));
}

export function lookupReply(request) {
  return request.correction
    ?'Brawl Stars has its own playable characters, called **Brawlers**. Supercell’s official Brawl Stars page is in the sources below.'
    :'';
}

export function lookupEvidence(request,sources) {
  const subject=request.topic?' Keep the reply about '+request.topic+'. If the user corrects a mistake, acknowledge it directly and continue on that subject. Do not switch to another game or invent characters.':'';
  return [
    'Use the reference excerpts below as factual evidence only. Answer the latest question. If the excerpts lack the detail requested, say what you could not verify. Do not invent sources or say you performed searches beyond these results.'+subject,
    ...sources.map(source=>source.title+'\n'+source.extract)
  ].join('\n\n');
}
