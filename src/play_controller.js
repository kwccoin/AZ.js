/**
 * @file MVCのコントローラのオブザーバークラスです。
 */
/*
 * @author 市川雄二
 * @copyright 2018 ICHIKAWA, Yuji (New 3 Rs)
 * @license MIT
 */
/* global $ JGO i18n */
import { i18nSpeak } from './speech.js';
import { SearchMode } from './search_mode.js';

/**
 * MVCのコントローラのオブザーバークラスです。
 * 思考エンジンの起動と着手、クロック更新、終局処理をします。
 */
export class PlayController {
    /**
     * @param {AZjsEngine} engine 
     * @param {BoardController} controller 
     * @param {number} mainTime 
     * @param {number} byoyomi 
     * @param {bool} fisherRule 
     * @param {string} mode 'best': 手の選択がbestでかつponder on, 'standard': 手の選択がbestでかつponder off, 'reception': 手の選択が接待でかつponder off
     * @param {bool} ponder
     * @param {bool} isSelfPlay 
     */
    constructor(engine, controller, mainTime, byoyomi, fisherRule, mode, isSelfPlay) {
        this.engine = engine;
        this.controller = controller;
        this.isSelfPlay = isSelfPlay;
        this.byoyomi = byoyomi;
        this.fisherRule = fisherRule;
        this.mode = SearchMode.fromString(mode);
        this.ponder = mode === 'very-hard' && !isSelfPlay;
        this.isFirstMove = true;
        if (this.fisherRule) {
            this.timeLeft = [
                0, // dumy
                mainTime * 1000, // black
                mainTime * 1000, // white
            ];
            this.start = Date.now();
            this.timer = setInterval(() => {
                const start = Date.now();
                this.timeLeft[this.controller.turn] -= start - this.start;
                this.start = start;
                if (this.isSelfPlay) {
                    // AIのセルフプレイの時には右の情報(時計、アゲハマ)が黒、左の情報(時計、アゲハマ)が白です。
                    $(this.controller.turn === JGO.BLACK ? '#right-clock' : '#left-clock').text(Math.ceil(this.timeLeft[this.controller.turn] / 1000));
                } else {
                    // ユーザーとAIの対戦の時には右の情報(時計、アゲハマ)がユーザー、左の情報(時計、アゲハマ)がAIです。
                    if (this.controller.ownColor === this.controller.turn) {
                        $('#right-clock').text(Math.ceil(this.timeLeft[this.controller.turn] / 1000));
                    } else {
                        $('#left-clock').text(Math.ceil(this.timeLeft[JGO.opponentOf(this.controller.turn)] / 1000));
                    }
                }
                if (this.timeLeft[this.controller.turn] < 0) {
                    clearInterval(this.timer);
                    this.timer = null;
                    this.engine.stop();
                    alert(i18n.timeout);
                }
            }, 100);
        } else {
            this.timeLeft = [
                0, // dumy
                this.isSelfPlay || this.controller.ownColor !== JGO.BLACK ? this.engine.byoyomi * 1000 : Infinity, // black
                this.isSelfPlay || this.controller.ownColor !== JGO.WHITE ? this.engine.byoyomi * 1000 : Infinity, // white
            ];
            this.start = Date.now();
            this.timer = setInterval(() => {
                const start = Date.now();
                this.timeLeft[this.controller.turn] -= start - this.start;
                this.start = start;
                let clock;
                if (this.isSelfPlay) {
                    clock = this.controller.turn === JGO.BLACK ? '#right-clock' : '#left-clock';
                } else {
                    clock = this.controller.turn === this.controller.ownColor ? '#right-clock' : '#left-clock';
                }
                $(clock).text(Math.ceil(this.timeLeft[this.controller.turn] / 1000));
            }, 100);
        }
        if (this.isSelfPlay) {
            $('#right-clock').text(Math.ceil(this.timeLeft[JGO.BLACK] / 1000));
            $('#left-clock').text(Math.ceil(this.timeLeft[JGO.WHITE] / 1000));
            $('#left-winrate')
                .css('color', 'black')
                .css('background-color', 'white');
            $('#right-winrate')
                .css('color', 'white')
                .css('background-color', 'black');
        } else {
            $('#right-clock').text(Math.ceil(this.timeLeft[this.controller.ownColor] / 1000));
            $('#left-clock').text(Math.ceil(this.timeLeft[JGO.opponentOf(this.controller.ownColor)] / 1000));
            if (this.controller.ownColor === JGO.BLACK) {
                $('#left-winrate')
                    .css('color', 'black')
                    .css('background-color', 'white');
                $('#right-winrate')
                    .css('color', 'white')
                    .css('background-color', 'black');
            } else {
                $('#left-winrate')
                    .css('color', 'white')
                    .css('background-color', 'black');
                $('#right-winrate')
                    .css('color', 'black')
                    .css('background-color', 'white');
            }
        }
        this.updateWinrateBar(0.5);
    }

    clearTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * AI同士のセルフプレイかどうかを設定します。
     * @param {*} isSelfPlay 
     */
    setIsSelfPlay(isSelfPlay) {
        this.isSelfPlay = isSelfPlay;
    }

    /**
     * 終局処理
     * @private
     */
    async endGame() {
        i18nSpeak(i18n.scoring);
        try {
            const score = await this.finalScore();
            let message;
            if (score === 0) {
                message = i18n.jigo;
            } else {
                message = i18n[score > 0 ? 'black' : 'white'];
                switch (i18n.lang) {
                    case 'en':
                    message += ` won by ${score} points`;
                    break;
                    case 'ja': {
                        const absScore = Math.abs(score);
                        message += absScore < 1 ? '半目勝ち' : Math.floor(absScore) + '目半勝ち';
                    }
                    break;
                }
            }
            switch (i18n.lang) {
                case 'en':
                message += '?';
                break;
                case 'ja':
                message += 'ですか？';
                break;
            }
            i18nSpeak(message.replace('半', 'はん'));
            setTimeout(function() {
                alert(message);
                $(document.body).addClass('end');
            }, 3000);
        } catch (e) {
            console.log(e);
            i18nSpeak(i18n.failScoring);
        }
    }

    updateClock() {
        if (this.fisherRule) {
            const played = JGO.opponentOf(this.controller.turn);
            const $playedTimer = $(this.isSelfPlay ?
                played === JGO.BLACK ? '#right-clock' : '#left-clock' :
                played === this.controller.ownColor ? '#right-clock' : '#left-clock');
            $playedTimer.text(`${Math.ceil(this.timeLeft[played] / 1000)}+${this.byoyomi}`);
            this.timeLeft[played] += this.byoyomi * 1000;
            setTimeout(() => {
                $playedTimer.text(Math.ceil(this.timeLeft[played] / 1000));
            }, 2000);
        } else {
            if (this.isSelfPlay) {
                const played = JGO.opponentOf(this.controller.turn);
                this.timeLeft[played] = this.engine.byoyomi * 1000;
                $(played === JGO.BLACK ? '#right-clock' : '#left-clock').text(Math.ceil(this.timeLeft[played] / 1000));
            } else if (this.controller.turn === this.controller.ownColor) {
                this.timeLeft[JGO.opponentOf(this.controller.turn)] = this.engine.byoyomi * 1000;
                $('#left-clock').text(Math.ceil(this.timeLeft[JGO.opponentOf(this.controller.turn)] / 1000));
            }
        }
    }

    async updateEngine(coord) {
        if (!this.isSelfPlay && typeof coord === 'object') {
            await this.engine.stop();
            await this.engine.play(coord.i + 1, this.controller.jboard.height - coord.j);
        }
    }

    updateWinrateBar(leftWinRate) {
        leftWinRate = leftWinRate * 100;
        const $leftWinrate = $('#left-winrate');
        const $rightWinrate = $('#right-winrate');
        $leftWinrate.css('width', `${leftWinRate}%`);
        $leftWinrate.text(`${leftWinRate.toFixed(1)}%`);
        $leftWinrate.attr('aria-valuenow', leftWinRate.toFixed(1));
        $rightWinrate.css('width', `${100 - leftWinRate}%`);
        $rightWinrate.text(`${(100 - leftWinRate).toFixed(1)}%`);
        $rightWinrate.attr('aria-valuenow', (100 - leftWinRate).toFixed(1));
    }

    async enginePlay() {
        const start = Date.now();
        const [move, winRate, num] = await this.engine.genmove(this.mode);
        $('#playouts').text(num);
        if (num !== 0) {
            $('#nps').text((num * 1000 / (Date.now() - start)).toFixed(1));
        }
        this.updateWinrateBar(this.isSelfPlay && this.controller.turn === JGO.BLACK ? 1.0 - winRate : winRate);

        if (!this.timer) {
            return; // 時間切れもしくは相手の投了
        }
        switch (move) {
            case 'resign':
            this.clearTimer();
            i18nSpeak(i18n.resign);
            if (this.isSelfPlay) {
                i18nSpeak(i18n.endGreet);
            }
            $(document.body).addClass('end');
            break;
            case 'pass':
            this.controller.play(null);
            i18nSpeak(i18n.pass);
            break;
            default:
            this.controller.play(new JGO.Coordinate(move[0] - 1, this.controller.jboard.height - move[1]), true);
        }
        if (this.fisherRule) {
            await this.engine.timeSettings(this.timeLeft[JGO.opponentOf(this.controller.turn)] / 1000, this.byoyomi);
        }
    }

    /**
     * BoardControllerのオブザーバーになるためのメソッド
     * @param {JGO.Coordinate} coord 
     */
    async update(coord) {
        if (coord === 'end') {
            this.clearTimer();
            await this.endGame();
            return;
        }
        if (!this.isFirstMove) {
            this.updateClock();
        } else {
            this.isFirstMove = false;
        }
        if (!this.isSelfPlay && this.controller.turn !== this.controller.ownColor) {
            this.coord = coord; // ポンダーと一致するか確認するために直前の座標を保存。
            await this.updateEngine(coord);
        }
        if (this.isSelfPlay || this.controller.turn !== this.controller.ownColor) {
            setTimeout(async () => {
                try {
                    await this.enginePlay();
                } catch (e) {
                    console.error(e);
                    if (e === 'RangeError: Source is too large') {
                        alert(i18n.sourceIsTooLarge);
                    } else {
                        alert(e);
                    }
                }
            }, 0);
        } else if (this.ponder) {
            const [move, winrate] = await this.engine.ponder();
            this.updateWinrateBar(1.0 - winrate);
            // ponderが終了するときには次の着手が打たれていて、this.coordに保存されている。
            if (move[0] === this.coord.i + 1 && move[1] === this.controller.jboard.height - this.coord.j) {
                const $thumbsUp = $('#thumbs-up');
                $thumbsUp.text(parseInt($thumbsUp.text()) + 1);
            }
        }
    }

    async pass() {
        if (!this.isSelfPlay && this.controller.ownColor === this.controller.turn) {
            await this.engine.stop();
            this.engine.pass();
            this.controller.play(null);
        }
    }

    async finalScore() {
        const result = await $.post({
            url: 'https://mimiaka-python.herokuapp.com/gnugo', // httpでは通信できなかった。 'http://35.203.161.100/gnugo',
            data: {
                sgf: this.controller.jrecord.toSgf(),
                move: 'est',
                method: 'aftermath',
                rule: this.controller.jrecord.getRootNode().info.komi === '6.5' ? 'japanese' : 'chinese'
            }
        });
        if (/Jigo/.test(result)) {
            return 0;
        }
        const match = result.match(/(Black|White) wins by ([0-9.]+) points/);
        if (match) {
            let score = parseFloat(match[2]);
            if (match[1] === 'Black') {
                return score;
            } else {
                return -score;
            }
        } else {
            return null;
        }
    }
}
