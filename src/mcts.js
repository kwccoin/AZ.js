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
import { Board } from './board.js';

const NODES_MAX_LENGTH = 16384;
const EXPAND_CNT = 8;


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
        this.hashes = new Uint32Array(this.C.BVCNT + 1);
        /** moves要素に対応する局面のニューラルネットワークを計算したか否かを保持します。 */
        this.evaluated = new Uint8Array(this.C.BVCNT + 1); 
        this.totalValue = 0.0;
        this.totalCount = 0;
        this.hash = 0;
        this.moveNumber = -1;
        this.exitCondition = null;
        this.clear();
    }

    /** 未使用状態にします。 */
    clear() {
        this.edgeLength = 0;
        this.totalValue = 0.0;
        this.totalCount = 0;
        this.hash = 0;
        this.moveNumber = -1;
    }

    /**
     * 初期化します。
     * @param {object} candidates Boardが生成する候補手情報です。
     * @param {Float32Array} prob 着手確率(ニューラルネットワークのポリシー出力)です。
     */
    initialize(candidates, prob) {
        this.clear();
        this.moveNumber = candidates.moveNumber;
        this.hash = candidates.hash;

        for (const rv of argsort(prob, true)) {
            if (candidates.list.includes(rv)) {
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
     * エッジの中のベスト2のインデックスを返します。
     * @returns {Integer[]}
     */
    best2() {
        const order = argsort(this.visitCounts.slice(0, this.edgeLength), true);
        return order.slice(0, 2);
    }
}

/** モンテカルロツリー探索を実行するクラスです。 */
export class MCTS {
    /**
     * コンストラクタ
     * @param {NeuralNetwork} nn 
     * @param {BoardConstants} C
     */
    constructor(nn, C) {
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
     * 局面bのMCTSの探索ノードが既にあるか確認し、なければ生成してノードIDを返します。
     * @param {Board} b 
     * @param {Float32Array} prob 
     * @returns {Integer} ノードID
     */
    createNode(b, prob) {
        const candidates = b.candidates();
        const hash = candidates.hash;
        if (this.nodeHashes.has(hash) &&
            this.nodes[this.nodeHashes.get(hash)].hash === hash &&
            this.nodes[this.nodeHashes.get(hash)].moveNumber === candidates.moveNumber) {
                return this.nodeHashes.get(hash);

        }

        let nodeId = hash % NODES_MAX_LENGTH;
        while (this.nodes[nodeId].moveNumber !== -1) {
            nodeId = nodeId + 1 < NODES_MAX_LENGTH ? nodeId + 1 : 0;
        }

        this.nodeHashes.set(hash, nodeId);
        this.nodesLength += 1;

        const node = this.nodes[nodeId];
        node.initialize(candidates, prob);
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
            const mc = this.nodes[i].moveNumber;
            if (mc != null && mc < this.rootMoveNumber) {
                this.nodeHashes.delete(this.nodes[i].hash);
                this.nodes[i].clear();
            }
        }
    }

    /**
     * UCB評価で最善の着手情報を返します。
     * @param {Board} b 
     * @param {Integer} nodeId 
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
     */
    shouldSearch(best, second) {
        const node = this.nodes[this.rootId];
        const winrate = this.winrate(node, best);

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
     * @param {Integer} nodeId 
     * @param {Integer} edgeIndex 
     * @param {Integer} moveNumber 
     * @returns {bool}
     */
    hasEdgeNode(edgeIndex, nodeId, moveNumber) {
        const node = this.nodes[nodeId];
        const edgeId = node.nodeIds[edgeIndex];
        return edgeId >= 0 &&
            node.hashes[edgeIndex] === this.nodes[edgeId].hash &&
            this.nodes[edgeId].moveNumber === moveNumber;
    }

    /**
     * indexのエッジの勝率を返します。
     * @param {Node} node 
     * @param {Integer} index 
     * @returns {number}
     */
    winrate(node, index) {
        return node.totalActionValues[index] / Math.max(node.visitCounts[index], 1) / 2.0 + 0.5;
    }

    /**
     * printInfoのヘルパー関数です。
     * @private
     * @param {Integer} nodeId 
     * @param {*} headMove 
     * @param {BoardConstants} c 
     */
    bestSequence(nodeId, headMove, c) {
        let seqStr = ('   ' + c.ev2str(headMove)).slice(-5);
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
            seqStr += '->' + ('   ' + c.ev2str(nextMove)).slice(-5);

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
        const order = argsort(node.visitCounts.slice(0, node.edgeLength), true);
        console.log('|move|count  |rate |value|prob | best sequence');
        for (let i = 0; i < Math.min(order.length, 9); i++) {
            const m = order[i];
            const visitCounts = node.visitCounts[m];
            if (visitCounts === 0) {
                break;
            }

            const rate = visitCounts === 0 ? 0.0 : this.winrate(node, m) * 100.0;
            const value = (node.values[m] / 2.0 + 0.5) * 100.0;
            console.log(
                '|%s|%s|%s|%s|%s| %s',
                ('   ' + c.ev2str(node.moves[m])).slice(-4),
                (visitCounts + '      ').slice(0, 7),
                ('  ' + rate.toFixed(1)).slice(-5),
                ('  ' + value.toFixed(1)).slice(-5),
                ('  ' + (node.probabilities[m] * 100.0).toFixed(1)).slice(-5),
                this.bestSequence(node.nodeIds[m], node.moves[m], c)
            );
        }
    }

    /**
     * 検索の前処理です。
     * @private
     * @param {Board} b 
     */
    async prepareRootNode(b) {
        const hash = b.hash();
        this.rootMoveNumber = b.moveNumber;
        this.C_PUCT = this.rootMoveNumber < 8 ? 0.01 : 1.5;
        if (this.nodeHashes.has(hash) &&
            this.nodes[this.nodeHashes.get(hash)].hash === hash &&
            this.nodes[this.nodeHashes.get(hash)].moveNumber === this.rootMoveNumber) {
                this.rootId = this.nodeHashes.get(hash);

        } else {
            const [prob] = await this.nn.evaluate(b.feature());

            // AlphaGo Zeroでは自己対戦時にはここでprobに"Dirichletノイズ"を追加しますが、本コードでは強化学習は予定していないので記述しません。

            this.rootId = this.createNode(b, prob);
        }
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
        let [prob, value] = await this.nn.evaluate(b.feature());
        this.evalCount += 1;
        value = -value[0]; // parentNodeの手番から見たバリューに変換します。
        parentNode.values[edgeIndex] = value;
        parentNode.evaluated[edgeIndex] = true;
        if (this.nodesLength > 0.85 * NODES_MAX_LENGTH) {
            this.cleanupNodes();
        }
        const nodeId = this.createNode(b, prob);
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
     */
    async playout(b, nodeId) {
        const node = this.nodes[nodeId];
        const [selectedIndex, selectedId, selectedMove] = this.selectByUCB(b, node);
        b.play(selectedMove);
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
        node.visitCounts[selectedIndex] += 1;
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
     * 探索が必要か判定して必要に応じて検索し、最善と判断した着手と勝率を返します。
     * @private
     * @param {Board} b 
     * @param {bool} ponder trueのときstopメソッドが呼ばれるまで探索を継続します
     * @param {bool} clean 形勢が変わらない限りパス以外の着手を選びます
     * @returns {Array} [着手(書く朝鮮系座標), 勝率]
     */
    async _search(b, ponder, clean) {
        // AlphaGo Zeroでは自己対戦の序盤30手まではエッジの総訪問回数から確率分布を算出して乱数で着手を洗濯しますが、本コードでは強化学習は予定していないので最善と判断した着手を返します。
        let best;
        let second;
        if (ponder || this.shouldSearch(best, second)) {
            await this.keepPlayout(b);
            const best2 = this.nodes[this.rootId].best2();
            best = best2[0];
            second = best2[1];
        } else {
            const best2 = this.nodes[this.rootId].best2();
            best = best2[0];
            second = best2[1];
        }

        const node = this.nodes[this.rootId];

        if (clean && node.moves[best] === b.C.PASS &&
            node.totalActionValues[best] * node.totalActionValues[second] > 0.0) {
            return [node.moves[second], this.winrate(node, second)];
        } else {
            return [node.moves[best], this.winrate(node, best)];
        }
    }

    /**
     * MCTS探索メソッドです。
     * _searchメソッドのラッパーメソッドです。
     * 終了条件を設定し、局面bをtime時間探索し、結果をログ出力して次の一手と勝率を返します。
     * @param {Board} b 
     * @param {number} time 探索時間を秒単位で指定します
     * @param {bool} ponder ttrueのときstopメソッドが呼ばれるまで探索を継続します
     * @param {bool} clean 形勢が変わらない限りパス以外の着手を選びます
     * @returns {Array} [着手(書く朝鮮系座標), 勝率]
     */
    async search(b, time, ponder, clean) {
        const start = Date.now();
        await this.prepareRootNode(b);

        if (this.nodes[this.rootId].edgeLength <= 1) { // 候補手がパスしかなければ
            console.log('\nmove number=%d:', this.rootMoveNumber + 1);
            this.printInfo(this.rootId, b.C);
            return [b.C.PASS, 0.5];
        }

        this.cleanupNodes();

        const time_ = (time === 0.0 ? this.getSearchTime(b.C) : time) * 1000 - 500; // 0.5秒のマージン
        this.terminateFlag = false;
        this.exitCondition = ponder ? function() {
            return this.terminateFlag;
        } : function() {
            return this.terminateFlag || Date.now() - start > time_;
        };
        const [nextMove, winRate] = await this._search(b, ponder, clean);

        if (!ponder) {
            console.log(
                '\nmove number=%d: left time=%s[sec] evaluated=%d',
                this.rootMoveNumber + 1,
                Math.max(this.leftTime - time, 0.0).toFixed(1),
                this.evalCount);
            this.printInfo(this.rootId, b.C);
            this.leftTime = this.leftTime - (Date.now() - start) / 1000;
        }
        return [nextMove, winRate];
    }

    /**
     * 実行中のkeepPlayoutを停止させます。
     */
    stop() {
        this.terminateFlag = true;
    }
}
