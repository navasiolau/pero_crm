export type ProductCardCoverAction = {type:"fullscreen"} | {type:"navigate";onOpen:()=>void};

export function openProductCardCover(action:ProductCardCoverAction|undefined,openFullscreen:()=>void,dragging=false) {
  if(dragging)return;
  if(action?.type==="navigate")action.onOpen();
  else openFullscreen();
}
