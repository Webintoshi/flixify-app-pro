import type { PersonalMediaItem, PersonalProgramme } from '../platform/personal-provider';
export function liveTransport(url: string): 'hls' | 'ts' | 'mp4' | 'mkv' | 'unknown' {
 const path = new URL(url).pathname.toLowerCase();
 return path.endsWith('.m3u8') ? 'hls' : path.endsWith('.ts') ? 'ts' : path.endsWith('.mp4') ? 'mp4' : path.endsWith('.mkv') ? 'mkv' : 'unknown';
}
export function mapPersonalLive(item: PersonalMediaItem) {
 return { id:item.id, title:item.title, groupTitle:item.groupTitle ?? null, logoUrl:item.posterUrl ?? null, personalRef:item.personalRef, playbackAllowed:true, available:true, transport:liveTransport(`https://stream.invalid/channel.${item.personalRef.extension ?? 'm3u8'}`), healthStatus:'unknown' as const };
}
export function selectedProgrammes(rows: PersonalProgramme[], now=Date.now()) { return rows.filter(row=>row.end>now).sort((a,b)=>a.start-b.start); }
export function createLiveRequestScope() {let generation=0;return {begin:()=>++generation,current:(value:number)=>value===generation,clear:()=>{generation++;}};}
