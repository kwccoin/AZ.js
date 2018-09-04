/**
 * @file モンテカルロツリー探索の実装です。
 * このコードはPyaqの移植コードです。
 * @see {@link https://github.com/ymgaq/Pyaq}
 */
/*
 * @author 市川雄二
 * @copyright 2018 ICHIKAWA, Yuji (New 3 Rs)
 * @license MIT
 */
import { argsort, argmax, printProb } from './utils.js';
import { IntersectionState } from './board_constants.js';
import { Board } from './board.js';

const NODES_MAX_LENGTH = 16384;
const EXPAND_CNT = 8;
const COLLISION_DETECT = true;

/** MCTSのノードクラスです。 */
class Node {
    /**
     * MCTSのノードを生成します。
     * @param {BoardConstants} constants
     */
    constructor(constants) {
        this.C = constants;
        /** 着手候補数です。(名前のedgeはグラフ理論の枝のことです。) */
        this.edgeLength = 0;
        //頻繁なメモリアロケーションを避けるため、枝情報に必要な最大メモリを予め確保します。
        /** ポリシー確率の高い順並んだ着手候補です。 */
        this.moves = new Uint16Array(this.C.BVCNT + 1); 
        /** moves要素に対応するポリシー確率です。 */
        this.probabilities = new Float32Array(this.C.BVCNT + 1); 
        /** moves要素に対応するバリューです。ただしノードの手番から見ての値です。 */
        this.values = new Float32Array(this.C.BVCNT + 1);
        /** moves要素に対応する総アクションバリューです。ただしノードの手番から見ての値です。 */
        this.totalActionValues = new Float32Array(this.C.BVCNT + 1);
        /** moves要素に対応する訪問回数です。 */
        this.visitCounts = new Uint32Array(this.C.BVCNT + 1);
        /** moves要素に対応するノードIDです。 */
        this.nodeIds = new Int16Array(this.C.BVCNT + 1);
        /** moves要素に対応するハッシュです。 */
        this.hashes = new Int32Array(this.C.BVCNT + 1);
        /** moves要素に対応する局面のニューラルネットワークを計算したか否かを保持します。 */
        this.evaluated = new Uint8Array(this.C.BVCNT + 1); 
        this.totalValue = 0.0;
        this.totalCount = 0;
        this.hashValue = 0;
        this.moveNumber = -1;
        this.sortedIndices = null;
        this.position = null;
        this.clear();
    }

    /** 未使用状態にします。 */
    clear() {
        this.edgeLength = 0;
        this.totalValue = 0.0;
        this.totalCount = 0;
        this.hashValue = 0;
        this.moveNumber = -1;
        this.sortedIndices = null;
        this.position = null;
    }

    /**
     * 初期化します。
     * @param {Integer} hash 現局面のハッシュです。
     * @param {Integer} moveNumber 現局面の手数です。
     * @param {UInt16[]} candidates Boardが生成する候補手情報です。
     * @param {Float32Array} prob 着手確率(ニューラルネットワークのポリシー出力)です。
     */
    initialize(hash, moveNumber, candidates, prob, position = null) {
        this.clear();
        this.hashValue = hash;
        this.moveNumber = moveNumber;
        this.position = position;

        for (const rv of argsort(prob, true)) {
            if (candidates.includes(rv)) {
                this.moves[this.edgeLength] = this.C.rv2ev(rv);
                this.probabilities[this.edgeLength] = prob[rv];
                this.values[this.edgeLength] = 0.0;
                this.totalActionValues[this.edgeLength] = 0.0;
                this.visitCounts[this.edgeLength] = 0;
                this.nodeIds[this.edgeLength] = -1;
                this.hashes[this.edgeLength] = 0;
                this.evaluated[this.edgeLength] = false;
                this.edgeLength += 1;
            }
        }
    }

    /**
     * indexのエッジの勝率を返します。
     * @param {Integer} index 
     * @returns {number}
     */
    winrate(index) {
        return this.totalActionValues[index] / Math.max(this.visitCounts[index], 1) / 2.0 + 0.5;
    }

    /**
     * visitCountsを1増やし、sortedIndicesをクリアします。
     * @param {Integer} index 
     */
    incrementVisitCount(index) {
        this.visitCounts[index] += 1;
        this.sortedIndices = null;
    }

    /**
     * visitCountsの多い順のインデックスの配列を返します。
     */
    getSortedIndices() {
        if (this.sortedIndices == null) {
            this.sortedIndices = argsort(this.visitCounts.slice(0, this.edgeLength), true);
        }
        return this.sortedIndices;
    }
}

/** モンテカルロツリー探索を実行するクラスです。 */
export class MCTS {
    /**
     * コンストラクタ
     * @param {NeuralNetwork} nn 
     * @param {BoardConstants} C
     * @param {Function} evaluatePlugin
     */
    constructor(nn, C, evaluatePlugin = null) {
        this.C_PUCT = 0.01;
        this.mainTime = 0.0;
        this.byoyomi = 1.0;
        this.leftTime = 0.0;
        this.nodes = [];
        this.nodesLength = 0;
        for (let i = 0; i < NODES_MAX_LENGTH; i++) {
            this.nodes.push(new Node(C));
        }
        this.rootId = 0;
        this.rootMoveNumber = 0;
        this.nodeHashes = new Map();
        this.evalCount = 0;
        this.nn = nn;
        this.terminateFlag = false;
        this.exitCondition = null;
        this.evaluatePlugin = evaluatePlugin;
        this.collisions = 0;
    }

    /**
     * 持ち時間の設定をします。
     * 残り時間もリセットします。
     * @param {number} mainTime 秒
     * @param {number} byoyomi 秒
     */
    setTime(mainTime, byoyomi) {
        this.mainTime = mainTime;
        this.leftTime = mainTime;
        this.byoyomi = byoyomi;
    }

    /**
     * 残り時間を設定します。
     * @param {number} leftTime 秒
     */
    setLeftTime(leftTime) {
        this.leftTime = leftTime;
    }

    /**
     * 内部状態をクリアします。
     * 同一時間設定で初手から対局できるようになります。
     */
    clear() {
        this.leftTime = this.mainTime;
        for (const node of this.nodes) {
            node.clear();
        }
        this.nodesLength = 0;
        this.rootId = 0;
        this.rootMoveNumber = 0;
        this.nodeHashes.clear();
        this.evalCount = 0;
    }

    /**
     * this.nodesに同じ局面があればそのインデックスを返します。
     * なければnullを返します。
     * @param {Board} b 
     */
    getNodeIdInNodes(b) {
        const hash = b.hash();
        if (this.nodeHashes.has(hash)) {
            const id = this.nodeHashes.get(hash);
            if (b.moveNumber === this.nodes[id].moveNumber) {
                if (!COLLISION_DETECT || b.toString() === this.nodes[id].position) {
                    return id;
                } else {
                    this.collisions += 1;
                    console.log('hash collision');
                    b.showboard(false);
                    console.log(this.nodes[id].position);
                }
            }
        }
        return null;
    }
    /**
     * 局面bのMCTSの探索ノードが既にあるか確認し、なければ生成してノードIDを返します。
     * @param {Board} b 
     * @param {Float32Array} prob 
     * @returns {Integer} ノードID
     */
    createNode(b, prob) {
        const candidates = b.candidates();
        const hash = b.hash();
        let nodeId = Math.abs(hash) % NODES_MAX_LENGTH;
        while (this.nodes[nodeId].moveNumber !== -1) {
            nodeId = nodeId + 1 < NODES_MAX_LENGTH ? nodeId + 1 : 0;
        }

        this.nodeHashes.set(hash, nodeId);
        this.nodesLength += 1;

        const node = this.nodes[nodeId];
        node.initialize(hash, b.moveNumber, candidates, prob, b.toString());
        return nodeId;
    }

    /**
     * nodesの中の不要なノードを未使用状態に戻します。
     */
    cleanupNodes() {
        if (this.nodesLength < NODES_MAX_LENGTH / 2) {
            return;
        }
        for (let i = 0; i < NODES_MAX_LENGTH; i++) {
            const mn = this.nodes[i].moveNumber;
            if (mn >= 0 && mn < this.rootMoveNumber) {
                this.nodeHashes.delete(this.nodes[i].hashValue);
                this.nodes[i].clear();
            }
        }
    }

    /**
     * UCB評価で最善の着手情報を返します。
     * @param {Board} b 
     * @param {Node} node 
     * @returns {Array} [UCB選択インデックス, 最善ブランチの子ノードID, 着手]
     */
    selectByUCB(b, node) {
        const ndRate = node.totalCount === 0 ? 0.0 : node.totalValue / node.totalCount;
        const cpsv = this.C_PUCT * Math.sqrt(node.totalCount);
        const meanActionValues = new Float32Array(node.edgeLength);
        for (let i = 0; i < meanActionValues.length; i++) {
            meanActionValues[i] = node.visitCounts[i] === 0 ? ndRate : node.totalActionValues[i] / node.visitCounts[i];
        }
        const ucb = new Float32Array(node.edgeLength);
        for (let i = 0; i < ucb.length; i++) {
            ucb[i] = meanActionValues[i] + cpsv * node.probabilities[i] / (1 + node.visitCounts[i]);
        }
        const selectedIndex = argmax(ucb);
        const selectedId = node.nodeIds[selectedIndex];
        const selectedMove = node.moves[selectedIndex];
        return [selectedIndex, selectedId, selectedMove];
    }

    /**
     * 検索するかどうかを決定します。
     * @param {Integer} best 
     * @param {Integer} second 
     * @returns {bool}
     */
    shouldSearch(best, second) {
        const node = this.nodes[this.rootId];
        const winrate = node.winrate(best);

        // 訪問回数が足りていないか、際立った手がなくかつはっきり勝ちじゃないとき
        return node.totalCount <= 5000 ||
            (node.visitCounts[best] <= node.visitCounts[second] * 100 &&
            winrate <= 0.95)
    }

    /**
     * 次の着手の考慮時間を算出します。
     * @returns {number} 使用する時間(秒)
     */
    getSearchTime(C) {
        if (this.mainTime === 0.0 || this.leftTime < this.byoyomi * 2.0) {
            return Math.max(this.byoyomi, 1.0);
        } else {
            // 碁盤を埋めることを仮定し、残りの手数を算出します。
            const assumedRemainingMoves = (C.BVCNT - this.rootMoveNumber) / 2;
            //布石ではより多くの手数を仮定し、急ぎます。
            const openingOffset = Math.max(C.BVCNT / 10 - this.rootMoveNumber, 0);
            return this.leftTime / (assumedRemainingMoves + openingOffset) + this.byoyomi;
        }
    }

    /**
     * nodeIdのノードのedgeIndexのエッジに対応するノードが既に存在するか返します。
     * @param {Integer} edgeIndex 
     * @param {Integer} nodeId 
     * @param {Integer} moveNumber 
     * @returns {bool}
     */
    hasEdgeNode(edgeIndex, nodeId, moveNumber) {
        const node = this.nodes[nodeId];
        const edgeId = node.nodeIds[edgeIndex];
        if (edgeId < 0) {
            return false;
        }
        return node.hashes[edgeIndex] === this.nodes[edgeId].hashValue &&
            this.nodes[edgeId].moveNumber === moveNumber;
    }

    /**
     * printInfoのヘルパー関数です。
     * @private
     * @param {Integer} nodeId 
     * @param {*} headMove 
     * @param {BoardConstants} c 
     */
    bestSequence(nodeId, headMove, c) {
        let seqStr = (c.ev2str(headMove) + '   ').slice(0, 3);
        let nextMove = headMove;

        for (let i = 0; i < 7; i++) {
            const node = this.nodes[nodeId];
            if (nextMove === c.PASS || node.edgeLength < 1) {
                break;
            }

            const best = argmax(node.visitCounts.slice(0, node.edgeLength));
            if (node.visitCounts[best] === 0) {
                break;
            }
            nextMove = node.moves[best];
            seqStr += '->' + (c.ev2str(nextMove) + '   ').slice(0, 3);

            if (!this.hasEdgeNode(best, nodeId, node.moveNumber + 1)) {
                break;
            }
            nodeId = node.nodeIds[best];
        }

        return seqStr;
    }

    /**
     * 探索結果の詳細を表示します。
     * @param {Integer} nodeId 
     * @param {BoardConstants} c
     */
    printInfo(nodeId, c) {
        const node = this.nodes[nodeId];
        const order = node.getSortedIndices();
        console.log('|move|count  |rate |value|prob | best sequence');
        const length = Math.min(order.length, 9);
        for (let i = 0; i < length; i++) {
            const m = order[i];
            const visitCount = node.visitCounts[m];
            if (visitCount === 0) {
                break;
            }

            const rate = visitCount === 0 ? 0.0 : node.winrate(m) * 100.0;
            const value = (node.values[m] / 2.0 + 0.5) * 100.0;
            console.log(
                '|%s|%s|%s|%s|%s| %s',
                (c.ev2str(node.moves[m]) + '    ').slice(0, 4),
                ('       ' + visitCount).slice(-7),
                ('  ' + rate.toFixed(1)).slice(-5),
                ('  ' + value.toFixed(1)).slice(-5),
                ('  ' + (node.probabilities[m] * 100.0).toFixed(1)).slice(-5),
                this.bestSequence(node.nodeIds[m], node.moves[m], c)
            );
        }
    }

    /**
     * ニューラルネットワークで局面を評価します。
     * @param {Board} b
     * @param {bool} random
     * @returns {Float32Array[]}
     */
    async evaluate(b, random = true) {
        let [prob, value] = await b.evaluate(this.nn, random);
        if (this.evaluatePlugin) {
            prob = this.evaluatePlugin(b, prob);
        }
        return [prob, value];
    }

    /**
     * 検索の前処理です。
     * @private
     * @param {Board} b 
     * @returns {Node}
     */
    async prepareRootNode(b) {
        this.rootMoveNumber = b.moveNumber;
        this.C_PUCT = this.rootMoveNumber < 8 ? 0.01 : 1.5;
        this.rootId = this.getNodeIdInNodes(b);
        if (this.rootId == null) {
            const [prob] = await this.evaluate(b);
            this.rootId = this.createNode(b, prob);
        }
        // AlphaGo Zeroでは自己対戦時にはここでprobに"Dirichletノイズ"を追加します。
        return this.nodes[this.rootId];
    }

    /**
     * edgeIndexのエッジの局面を評価しノードを生成してバリューを返します。
     * @private
     * @param {Board} b 
     * @param {Integer} edgeIndex 
     * @param {Node} parentNode 
     * @returns {number} parentNodeの手番から見たedge局面のバリュー
     */
    async evaluateEdge(b, edgeIndex, parentNode) {
        let [prob, value] = await this.evaluate(b);
        this.evalCount += 1;
        value = -value[0]; // parentNodeの手番から見たバリューに変換します。
        parentNode.values[edgeIndex] = value;
        parentNode.evaluated[edgeIndex] = true;
        if (this.nodesLength > 0.85 * NODES_MAX_LENGTH) {
            this.cleanupNodes();
        }
        const nodeId = this.createNode(b, prob);
        /*
        if (!this.isConsistentNode(nodeId, b)) {
            const node = this.nodes[nodeId];
            for (let i = 0; i < node.edgeLength; i++) {
                console.log(b.C.ev2str(node.moves[i]));
            }
            b.showboard();
            throw new Error('inconsistent node');
        }
        */
        parentNode.nodeIds[edgeIndex] = nodeId;
        parentNode.hashes[edgeIndex] = b.hash();
        parentNode.totalValue -= parentNode.totalActionValues[edgeIndex];
        parentNode.totalCount += parentNode.visitCounts[edgeIndex];
        return value;
    }

    /**
     * MCTSツリーをUCBに従って下り、リーフノードに到達したら展開します。
     * @private
     * @param {Board} b 
     * @param {Integer} nodeId
     * @returns {number} バリュー
     */
    async playout(b, nodeId) {
        const node = this.nodes[nodeId];
        const [selectedIndex, selectedId, selectedMove] = this.selectByUCB(b, node);
        try {
            b.play(selectedMove);
        } catch (e) {
            console.error(e);
            b.showboard();
            console.log('%s %d', b.C.ev2str(selectedMove), this.collisions);
            b.play(b.C.PASS);
        }
        const isHeadNode = !this.hasEdgeNode(selectedIndex, nodeId, b.moveNumber);
        /*
        // 以下はPyaqが採用したヘッドノードの条件です。
        const isHeadNode = !this.hasEdgeNode(selectedIndex, nodeId, b.moveNumber) ||
            node.visitCounts[selectedIndex] < EXPAND_CNT ||
            b.moveNumber > b.C.BVCNT * 2 ||
            (selectedMove === b.C.PASS && b.prevMove === b.C.PASS);
        */
        const value = isHeadNode ?
            (node.evaluated[selectedIndex] ?
                node.values[selectedIndex] :
                await this.evaluateEdge(b, selectedIndex, node)) :
            - await this.playout(b, selectedId); // selectedIdの手番でのバリューが返されるから符号を反転させます。
        node.totalValue += value;
        node.totalCount += 1;
        node.totalActionValues[selectedIndex] += value;
        node.incrementVisitCount(selectedIndex);
        return value;
    }

    /**
     * プレイアウトを繰り返してMCTSツリーを更新します。
     * @private
     * @param {Board} b 
     */
    async keepPlayout(b) {
        this.evalCount = 0;
        let bCpy = new Board(b.C, b.komi);
        do {
            b.copyTo(bCpy);
            await this.playout(bCpy, this.rootId);
        } while (!this.exitCondition());
    }

    /**
     * MCTS探索メソッドです。
     * 局面bをルートノード設定して、終了条件を設定し、time時間探索し、結果をログ出力してルートノードを返します。
     * @param {Board} b 
     * @param {number} time 探索時間を秒単位で指定します
     * @param {bool} ponder ttrueのときstopメソッドが呼ばれるまで探索を継続します
     * @param {bool} clean 形勢が変わらない限りパス以外の着手を選びます
     * @returns {Node} ルートノード
     */
    async search(b, time, ponder) {
        const start = Date.now();
        const rootNode = await this.prepareRootNode(b);

        if (rootNode.edgeLength <= 1) { // 候補手がパスしかなければ
            console.log('\nmove number=%d:', this.rootMoveNumber + 1);
            this.printInfo(this.rootId, b.C);
            return rootNode;
        }

        this.cleanupNodes();

        const time_ = (time === 0.0 ? this.getSearchTime(b.C) : time) * 1000 - 500; // 0.5秒のマージン
        this.terminateFlag = false;
        this.exitCondition = ponder ? () => this.terminateFlag :
            () => this.terminateFlag || Date.now() - start > time_;

        let [best, second] = rootNode.getSortedIndices();
        if (ponder || this.shouldSearch(best, second)) {
            await this.keepPlayout(b);
            [best, second] = rootNode.getSortedIndices();
        }

        console.log(
            '\nmove number=%d: left time=%s[sec] evaluated=%d collisions=%d',
            this.rootMoveNumber + 1,
            Math.max(this.leftTime - time, 0.0).toFixed(1),
            this.evalCount,
            this.collisions
        );
        this.printInfo(this.rootId, b.C);
        this.leftTime = this.leftTime - (Date.now() - start) / 1000;
        return rootNode;
    }

    /**
     * 実行中のkeepPlayoutを停止させます。
     */
    stop() {
        this.terminateFlag = true;
    }

    /**
     * 
     * @param {Integer} nodeId
     * @param {Board} b 
     */
    isConsistentNode(nodeId, b) {
        const node = this.nodes[nodeId];
        for (let i = 0; i < node.edgeLength; i++) {
            const ev = node.moves[i];
            if (ev === b.C.EBVCNT) {
                continue
            }
            if (b.state[ev] !== IntersectionState.EMPTY) {
                console.log('isConsistentNode', b.C.ev2str(ev));
                return false;
            }
        }
        return true
    }
}
