import type{Animal}from'./domain';
export const publicPageSize=5;
export function publicPagination(animals:Animal[],query:string|null,id?:string){
 const pages=Math.max(1,Math.ceil(animals.length/publicPageSize));let page=query&&/^[1-9]\d{0,2}$/.test(query)?Math.min(pages,Number(query)):1;
 if(id&&query===null){const at=animals.findIndex(a=>a.id===id);if(at>=0)page=Math.floor(at/publicPageSize)+1;}
 return{page,pages,rows:animals.slice((page-1)*publicPageSize,page*publicPageSize)};
}
export function publicListPath(slug:string,page=1){return `/u/${slug}${page>1?`?page=${page}`:''}`;}
export function animalBrief(animal:Animal){return[animal.species,animal.morph,animal.description].filter(Boolean).join(' / ');}
export function hatchDate(value:string|null){return value?value.replaceAll('-','.'):'미입력';}
