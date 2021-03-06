/**
 * @file ウェブワーカのエントリーポイントです。
 */
/*
 * @author 市川雄二
 * @copyright 2018 ICHIKAWA, Yuji (New 3 Rs)
 * @license MIT
 */
import { resigterWorkerRMI } from 'worker-rmi';
import { AZjsEngineBase } from './azjs_engine_base.js';

/**
 * アプリ特有のevaluatePlugin関数です。
 * thisはMCTSのインスタンスです。
 * @param {Board} b 
 */
function evaluatePlugin(b, prob) {
    switch (b.moveNumber) {
        case 0:
        switch (b.C.BSIZE) {
            case 19: {
                const moves = [
                    [17, 17],
                    [16, 16],
                    [17, 16],
                    [15, 17],
                    [15, 16]
                ];
                const move = moves[Math.floor(Math.random() * moves.length)];
                prob = new Float32Array(prob.length);
                for (let i = 0; i < prob.length; i++) {
                    const xy = b.C.ev2xy(b.C.rv2ev(i));
                    prob[i] = move[0] === xy[0] && move[1] === xy[1] ? 1.0 : 0.0;
                }
            }
            break;
        }
        break;
        case 1:
        switch (b.C.BSIZE) {
            case 19: {
                const moves = [
                    [3, 3],
                    [4, 4],
                    [3, 4],
                    [4, 3],
                    [3, 5],
                    [5, 3],
                    [4, 5],
                    [5, 4],
                    [3, 17],
                    [4, 16],
                    [3, 16],
                    [4, 17],
                    [5, 17],
                    [3, 15],
                    [5, 16],
                    [4, 15],
                    [17, 3],
                    [16, 4],
                    [17, 4],
                    [16, 3],
                    [15, 3],
                    [17, 5],
                    [15, 4],
                    [16, 5]
                ];
                const move = moves[Math.floor(Math.random() * moves.length)];
                prob = new Float32Array(prob.length);
                for (let i = 0; i < prob.length; i++) {
                    const xy = b.C.ev2xy(b.C.rv2ev(i));
                    prob[i] = move[0] === xy[0] && move[1] === xy[1] ? 1.0 : 0.0;
                }
            }
            break;
        }
        break;
    }
    return prob;
}

/** 対局を行う思考エンジンクラスです。 */
class AZjsEngine extends AZjsEngineBase {
    /**
     * AZjsEngineBaseにアプリ固有のevaluatePlugin関数を渡します。
     * @param {Integer} size 
     * @param {Number} komi 
     */
    constructor(size, komi) {
        super(size, komi, evaluatePlugin);
    }
}

resigterWorkerRMI(self, AZjsEngine);
