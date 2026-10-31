import test from 'node:test';
import assert from 'node:assert/strict';
import helpers from './live-favorites.ts';
const {hydrateLegacyLiveFavorites,legacyFavoriteMutationIds}=helpers;
test('legacy favorites coalesce using the complete catalog and only remove saved aliases',()=>{
 const selected={id:'fhd',kind:'live',title:'ATV',groupTitle:'TR'} as const;
 const saved=[{id:'4k',kind:'live',title:'ATV 4K'},selected,{id:'movie',kind:'movie',title:'Film'},{id:'missing',kind:'live',title:'Absent'}];
 const result=hydrateLegacyLiveFavorites(saved,[selected],new Map([['4k','fhd'],['fhd','fhd']]));
 assert.deepEqual(result.map(item=>item.id),['fhd','movie','missing']);
 assert.deepEqual(result[0].legacyFavoriteIds,['4k','fhd']);
 assert.deepEqual(legacyFavoriteMutationIds(selected,result[0]),['4k','fhd']);
 assert.deepEqual(legacyFavoriteMutationIds(selected),['fhd']);
 assert.equal(saved[0].id,'4k');assert.equal(saved[0].title,'ATV 4K');
 assert.equal(result[2].id,'missing');assert.equal(result[2].available,false);
});
