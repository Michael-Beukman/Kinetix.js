import { simToScreen } from "../js2d/engine";
import { ndarray, EnvParams, StaticEnvParams } from "../js2d/env_state";

export class SnapReturn {
    pos: ndarray;
    snap_line: ndarray[];
    snap_point: ndarray;
    dashedLine: boolean;
    constructor(pos: ndarray, snap_line: ndarray[] | null, snap_point: ndarray | null, dashedLine: boolean = false) {
        this.pos = pos;
        this.snap_line = snap_line;
        this.snap_point = snap_point;
        this.dashedLine = dashedLine;
    }

    addDrawToBuffer() {
        return this.draw.bind(this);
    }

    draw(p: p5, staticEnvParams: StaticEnvParams, envParams: EnvParams) {
        // draw line

        if (this.snap_line) {
            if (this.dashedLine) {
                p.push();
                // make dashed line
                p.drawingContext.setLineDash([5, 5]);
            }
            p.line(
                simToScreen(this.snap_line[0], staticEnvParams, envParams).get(0),
                simToScreen(this.snap_line[0], staticEnvParams, envParams).get(1),
                simToScreen(this.snap_line[1], staticEnvParams, envParams).get(0),
                simToScreen(this.snap_line[1], staticEnvParams, envParams).get(1)
            );
            if (this.dashedLine) {
                p.pop();
            }
        } else if (this.snap_point) {
            p.push();
            p.fill(255, 100);
            p.ellipse(
                simToScreen(this.snap_point, staticEnvParams, envParams).get(0),
                simToScreen(this.snap_point, staticEnvParams, envParams).get(1),
                10
            );
            p.pop();
        }
    }
}
