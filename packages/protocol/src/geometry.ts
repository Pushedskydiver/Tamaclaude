/** A dirty rectangle: the unit of everything we send to the device. */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Number of pixels a rectangle covers. */
export function rectArea(rect: Rect): number {
  return rect.width * rect.height;
}
