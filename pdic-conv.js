/*
 * pdic-conv.js v0.5.0
 *
 * Copyright (c) 2015-2018 na2co3
 * Released under the MIT License, see:
 * http://opensource.org/licenses/mit-license.php
 * 
 * Modified by kepeken
 */

/*
 * 未対応: 圧縮, 暗号化, ファイルリンクや埋め込みファイルやOLEオブジェクト
 */

const { Buffer } = require("buffer");
const bocu1 = require("./bocu1");

class FormatError {
	constructor(message) {
		this.message = message;
	}
}

class SeekableFile {
	constructor(arrayBuffer) {
		this.buffer = Buffer.from(arrayBuffer);
		this.position = 0;
	}

	read(buffer, length) {
		this.buffer.copy(buffer, 0, this.position, this.position + length);
		this.position += length;
	}

	seek(position) {
		this.position = position;
	}

	skip(length) {
		this.position += length;
	}
}

/*
 * DICファイルを読み込む
 * arrayBuffer: DICファイルのデータバッファ
 * writeEntry : コールバック関数。第1引数にエントリーオブジェクトが渡される
 *              DICファイル内のデータ順にそって各エントリーごとに呼ばれる
 *
 *   エントリーオブジェクト: {
 *     keyword : 見出語の検索キー
 *     word    : 見出語
 *     trans   : 訳語
 *     exp     : 用例
 *     level   : 単語レベル
 *     memory  : 暗記必須マーク
 *     modify  : 修正マーク
 *     pron    : 発音記号
 *     linkdata: ファイルリンク又は埋め込みファイル (未対応)
 *    }
 */
export function readPDIC(arrayBuffer, writeEntry) {
	let dic = new SeekableFile(arrayBuffer);
	let headerBuf = new Buffer(256);
	dic.read(headerBuf, 256);

	// --- header ---
	let header = {};
	// header.headername = headerBuf.toString("ascii", 0, 100);
	header.version = headerBuf.readInt16LE(0x8c);
	if (header.version >> 8 != 6) {
		throw new FormatError("Error: 非対応のバージョンです。バージョン: 0x" + header.version.toString(16));
	}
	header.index_block = headerBuf.readUInt16LE(0x94);
	// header.nword = headerBuf.readUInt32LE(0xa0);
	header.dictype = headerBuf.readUInt8(0xa5); // 0x01:バイナリを圧縮, 0x08:BOCU-1, 0x40:暗号化
	if (header.dictype & 64) {
		throw new FormatError("Error: 暗号化された辞書には対応していません");
	}
	// header.olenumber = headerBuf.readInt32LE(0xa8);
	header.index_blkbit = headerBuf.readUInt8(0xb6); //0:16bit, 1:32bit
	header.extheader = headerBuf.readUInt32LE(0xb8);
	// header.empty_block2 = headerBuf.readInt32LE(0xbc);
	header.nindex2 = headerBuf.readUInt32LE(0xc0);
	// header.nblock2 = headerBuf.readUInt32LE(0xc4);
	// header.cypt = headerBuf.slice(0xc8, 0xc8 + 8);
	// header.dicident = headerBuf.slice(0xd8, 0xd8 + 8);

	// --- index ---
	let indexOffset = 1024 + header.extheader;
	let index = new Array(header.nindex2);
	let blockIDBuf = new Buffer(4);
	let indexWordBuf = new Buffer(1);
	dic.seek(indexOffset);
	for (let index_id = 0; index_id < header.nindex2; index_id++) {
		if (!header.index_blkbit) { // 16bit index
			dic.read(blockIDBuf, 2);
			index[index_id] = blockIDBuf.readUInt16LE(0);
		} else {  // 32bit index
			dic.read(blockIDBuf, 4);
			index[index_id] = blockIDBuf.readUInt32LE(0);
		}
		do {
			dic.read(indexWordBuf, 1);
		} while (indexWordBuf[0] !== 0);
	}

	// --- data block ---
	let dataOffset = indexOffset + (header.index_block * 1024);
	let blockSpanBuf = new Buffer(2);
	let fieldLengthBuf = new Buffer(4);
	let omitLengthBuf = new Buffer(1);
	let wordFlagBuf = new Buffer(1);
	let tmp;
	for (let index_id = 0; index_id < header.nindex2; index_id++) {
		dic.seek(dataOffset + (index[index_id] * 1024));
		dic.read(blockSpanBuf, 2);
		let blockSpan = blockSpanBuf.readUInt16LE(0);
		if (blockSpan === 0) { // 空ブロック
			continue;
		}
		let fieldLengthBit = !!(blockSpan & 0x8000); // 0:16bit, 1:32bit
		// blockSpan &= 0x7fff;

		let prevRawWord = new Buffer(0);
		while (true) {
			let entry = {};

			let fieldLength;
			if (!fieldLengthBit) { // 16bit
				dic.read(fieldLengthBuf, 2);
				fieldLength = fieldLengthBuf.readUInt16LE(0);
			} else { // 32bit
				dic.read(fieldLengthBuf, 4);
				fieldLength = fieldLengthBuf.readUInt32LE(0);
			}
			if (fieldLength === 0) {
				break;
			}

			dic.read(omitLengthBuf, 1);
			let omitLength = omitLengthBuf[0];

			dic.read(wordFlagBuf, 1);
			let wordFlag = wordFlagBuf[0];
			if (wordFlag == 0xff) {
				dic.skip(fieldLength);
				continue; // リファレンス登録語(Ver.6.10で廃案)
			}
			entry.memory = !!(wordFlag & 0x20);
			entry.modify = !!(wordFlag & 0x40);
			entry.level = wordFlag & 0x0f;

			let fieldBuf = new Buffer(fieldLength);
			dic.read(fieldBuf, fieldLength);

			tmp = sliceBufferUntilNull(fieldBuf, 0);
			tmp.buffer = Buffer.concat([prevRawWord.slice(0, omitLength), tmp.buffer]);
			try {
				entry.word = bocu1.decode(tmp.buffer);
			} catch(e) {
				console.log(`WARNING: 見出し語のデコードに失敗しました : ${tmp.buffer.toString("hex")}`);
				entry.word = "";
			}
			prevRawWord = tmp.buffer;

			let nameSplitIndex = entry.word.indexOf("\t");
			if (nameSplitIndex >= 0) {
				entry.keyword = entry.word.substr(0, nameSplitIndex);
				entry.word = entry.word.substr(nameSplitIndex + 1);
			} else {
				entry.keyword = entry.word;
			}

			tmp = sliceBufferUntilNull(fieldBuf, tmp.next);
			try {
				entry.trans = bocu1.decode(tmp.buffer);
			} catch(e) {
				console.log(`WARNING: 訳語のデコードに失敗しました : ${entry.word} : ${tmp.buffer.toString("hex")}`);
				entry.trans = "";
			}

			if (wordFlag & 0x10) { // 拡張構成
				let fieldPtr = tmp.next;
				while (fieldPtr < fieldBuf.length) {
					let extFlag = fieldBuf[fieldPtr];
					let extType = extFlag & 0x0f; //1:exp, 2:pron, 4:linkdata
					if (extType & 0x80) {
						break;
					}
					fieldPtr++;

					if (!(extFlag & 0x10)) { // テキストデータ
						tmp = sliceBufferUntilNull(fieldBuf, fieldPtr);
						fieldPtr = tmp.next;

						let content;
						try {
							content = bocu1.decode(tmp.buffer);
						} catch(e) {
							console.log(`WARNING: ${extType == 1 ? "例文" : extType == 2 ? "発音" : "拡張データ(" + extType + ")"}のデコードに失敗しました : ${entry.word} : ${tmp.buffer.toString("hex")}`);
							continue;
						}
						if (extType == 1) {
							entry.exp = content;
							continue;
						} else if (extType == 2) {
							entry.pron = content;
							continue;
						} else if (extType == 0) {
							continue;
						}
						console.log(`Notice: 不明な拡張テキストデータ(${extType})が含まれています : ${entry.word} : "${content}"`)
					} else { // バイナリデータ
						let extSize;
						if (!fieldLengthBit) { // 16bit
							extSize = fieldBuf.readUInt16LE(fieldPtr);
							fieldPtr += 2;
						} else { // 32bit
							extSize = fieldBuf.readUInt32LE(fieldPtr);
							fieldPtr += 4;
						}
						fieldPtr += extSize;

						if (extType == 1) {
							console.log(`Notice: 訳語が圧縮されているかバイナリデータです。非対応のため無視します : ${entry.word}`);
						} else if (extType == 4) {
							console.log(`Notice: ファイルまたはオブジェクトが含まれています。非対応のため無視します : ${entry.word}`);
						} else if (extType == 0) {
							continue;
						} else {
							console.log(`Notice: 不明な拡張バイナリデータ(${extType})が含まれています : ${entry.word}`)
						}
					}
				}
			}
			writeEntry(entry);
		}
	}
}

function sliceBufferUntilNull(buffer, start) {
	let end = start;
	while (buffer[end] !== 0){
		end++;
		if (end >= buffer.length)
			break;
	}
	return {buffer: buffer.slice(start, end), next: end + 1};
}
