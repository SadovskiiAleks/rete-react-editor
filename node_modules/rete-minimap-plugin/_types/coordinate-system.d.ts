import { Rect } from './types';
export declare function useBoundingCoordinateSystem(rects: Rect[], minDistance: number, ratio: number): {
    origin: {
        x: number;
        y: number;
    };
    scale: (v: number) => number;
    invert: (v: number) => number;
};
//# sourceMappingURL=coordinate-system.d.ts.map