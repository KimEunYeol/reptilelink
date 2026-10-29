export const parentRoles = ['father','mother'] as const;
export type ParentRole = typeof parentRoles[number];
export type ParentAssets = Record<ParentRole,string|null>;
export const parentLabels:Record<ParentRole,string> = {father:'부',mother:'모'};
export function animalParents(value:{father_asset_id?:string|null;mother_asset_id?:string|null}):ParentAssets {
  return {father:value.father_asset_id??null,mother:value.mother_asset_id??null};
}
