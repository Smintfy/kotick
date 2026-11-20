const tab =
  'flex-none font-normal transition-[background-color,color] duration-120 ease-[ease] not-data-active:hover:bg-muted data-active:bg-accent data-active:text-foreground data-active:shadow-none! motion-reduce:transition-none';

/* A tab in the bar at the top of a box, such as a file tab. */
export const barTab = `${tab} h-7 px-[7px] text-[13px]`;

/* A tab above a box, such as Preview and Code. It has the size of the default button. */
export const outerTab = `${tab} h-8 rounded-lg px-2.5 text-sm`;
