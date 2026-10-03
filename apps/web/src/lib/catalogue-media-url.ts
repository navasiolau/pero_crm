export type CataloguePreview="thumbnail"|"card"|"cover";
export function catalogueMediaUrl(id:string,preview?:CataloguePreview){return `/api/catalogue-media/${encodeURIComponent(id)}${preview?`?preview=${preview}`:""}`;}
export function catalogueMediaKey(finishId:string,assetId:string){const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;if(!uuid.test(finishId)||!uuid.test(assetId))throw Error("CATALOGUE_MEDIA_SCOPE_INVALID");return `catalogue-media/${finishId.toLowerCase()}/${assetId.toLowerCase()}/original`;}
