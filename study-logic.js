/* Pure lesson selection logic. UMD: browser and Node.js test runner. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.CheeseStudy=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  const GROUPS=['A','B','C','D','unlearned'];
  function contentKey(word){
    return JSON.stringify([String(word.question??word.Q??''),String(word.answer??word.A??''),String(word.extra??word.Extra??'')]);
  }
  function latestStatuses(words,sessions){
    const currentIds=new Set(words.map(w=>String(w.id)));
    const byContent=new Map();
    for(const w of words){const k=contentKey(w);const prev=byContent.get(k)||[];prev.push(String(w.id));byContent.set(k,prev);}
    const latest=new Map();
    for(const session of sessions||[]){
      const items=session?.state?.testData;
      if(!Array.isArray(items))continue;
      for(let i=0;i<items.length;i++){
        const item=items[i];
        if(item?.Status!=='Completed')continue;
        const level=String(item.Level||'').charAt(0);
        if(!'ABCD'.includes(level)||!level)continue;
        let id=String(item.WordId??'');
        if(!currentIds.has(id)){
          const matches=byContent.get(contentKey(item))||[];
          // Old snapshots have no WordId. Never guess for ambiguous duplicates.
          if(matches.length!==1)continue;
          id=matches[0];
        }
        const completed=Date.parse(item.CompletedAt||'');
        const sessionTime=Date.parse(session.created_at||'')||0;
        const stamp=Number.isFinite(completed)?completed:sessionTime+i;
        const old=latest.get(id);
        if(!old||stamp>old.stamp||(stamp===old.stamp&&sessionTime>=old.sessionTime)){
          latest.set(id,{level,stamp,sessionTime});
        }
      }
    }
    return latest;
  }
  function countGroups(words,sessions){
    const latest=latestStatuses(words,sessions);
    const counts={A:0,B:0,C:0,D:0,unlearned:0};
    for(const word of words){const level=latest.get(String(word.id))?.level||'unlearned';counts[level]++;}
    return counts;
  }
  function selectWords(words,sessions,filter,mode,random=Math.random){
    const all=filter?.all!==false;
    const selected=new Set((filter?.groups||[]).filter(g=>GROUPS.includes(g)));
    const latest=latestStatuses(words,sessions);
    const chosen=words.filter(word=>all||selected.has(latest.get(String(word.id))?.level||'unlearned'));
    if(mode==='random'){
      for(let i=chosen.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[chosen[i],chosen[j]]=[chosen[j],chosen[i]];}
    }
    return chosen;
  }
  return {contentKey,latestStatuses,countGroups,selectWords};
});
