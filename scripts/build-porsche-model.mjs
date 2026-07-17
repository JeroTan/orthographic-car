import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Vector3 } from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const sourceUrl = new URL('../src/assets/porsche-car-model/Porsche_911_GT2.obj', import.meta.url);
const outputUrl = new URL('../src/assets/porsche-car-model/porsche-model.bin', import.meta.url);
const wheelParts = {
	'part 025': 'frontLeft',
	'part 028': 'frontRight',
	'part 026': 'rearLeft',
	'part 027': 'rearRight',
};
const sectionOrder = ['body', 'frontLeft', 'frontRight', 'rearLeft', 'rearRight'];
const headerSize = 8 + sectionOrder.length * 40;

function align(value, alignment) {
	return Math.ceil(value / alignment) * alignment;
}

function quantizeSigned(value, maximum) {
	return Math.round(Math.max(-1, Math.min(1, value)) * maximum);
}

function packGeometry(geometry) {
	geometry.computeBoundingBox();
	const bounds = geometry.boundingBox;
	if (!bounds) throw new Error('Porsche geometry has no bounds.');
	const center = bounds.getCenter(new Vector3());
	const halfExtent = bounds.getSize(new Vector3());
	halfExtent.x /= 2;
	halfExtent.y /= 2;
	halfExtent.z /= 2;

	const position = geometry.attributes.position;
	const normal = geometry.attributes.normal;
	const uv = geometry.attributes.uv;
	if (!normal || !uv || normal.count !== position.count || uv.count !== position.count) {
		throw new Error('Porsche geometry attributes do not match.');
	}

	const positions = new Int16Array(position.count * 3);
	const normals = new Int8Array(position.count * 3);
	const uvs = new Int16Array(position.count * 2);
	for (let index = 0; index < position.count; index += 1) {
		const positionOffset = index * 3;
		positions[positionOffset] = quantizeSigned(
			(position.getX(index) - center.x) / halfExtent.x,
			32767,
		);
		positions[positionOffset + 1] = quantizeSigned(
			(position.getY(index) - center.y) / halfExtent.y,
			32767,
		);
		positions[positionOffset + 2] = quantizeSigned(
			(position.getZ(index) - center.z) / halfExtent.z,
			32767,
		);
		normals[positionOffset] = quantizeSigned(normal.getX(index), 127);
		normals[positionOffset + 1] = quantizeSigned(normal.getY(index), 127);
		normals[positionOffset + 2] = quantizeSigned(normal.getZ(index), 127);
		const uvOffset = index * 2;
		uvs[uvOffset] = quantizeSigned(uv.getX(index), 32767);
		uvs[uvOffset + 1] = quantizeSigned(uv.getY(index), 32767);
	}

	return { center, halfExtent, positions, normals, uvs, vertexCount: position.count };
}

const source = await readFile(sourceUrl, 'utf8');
const root = new OBJLoader().parse(source);
const bodyGeometries = [];
const wheelGeometries = {};
for (const child of root.children) {
	if (!child.isMesh) continue;
	const wheelPosition = wheelParts[child.name];
	if (wheelPosition) wheelGeometries[wheelPosition] = child.geometry;
	else bodyGeometries.push(child.geometry);
}

const bodyGeometry = mergeGeometries(bodyGeometries, false);
if (!bodyGeometry) throw new Error('Porsche body geometry could not be merged.');
const sections = {
	body: packGeometry(bodyGeometry),
	frontLeft: packGeometry(wheelGeometries.frontLeft),
	frontRight: packGeometry(wheelGeometries.frontRight),
	rearLeft: packGeometry(wheelGeometries.rearLeft),
	rearRight: packGeometry(wheelGeometries.rearRight),
};

let dataOffset = headerSize;
for (const name of sectionOrder) {
	const section = sections[name];
	section.positionOffset = align(dataOffset, 2);
	dataOffset = section.positionOffset + section.positions.byteLength;
	section.normalOffset = dataOffset;
	dataOffset = section.normalOffset + section.normals.byteLength;
	section.uvOffset = align(dataOffset, 2);
	dataOffset = section.uvOffset + section.uvs.byteLength;
}

const output = new ArrayBuffer(dataOffset);
const view = new DataView(output);
for (const [index, character] of [...'PTM1'].entries()) view.setUint8(index, character.charCodeAt(0));
view.setUint32(4, sectionOrder.length, true);
for (const [index, name] of sectionOrder.entries()) {
	const section = sections[name];
	const offset = 8 + index * 40;
	view.setUint32(offset, section.vertexCount, true);
	view.setFloat32(offset + 4, section.center.x, true);
	view.setFloat32(offset + 8, section.center.y, true);
	view.setFloat32(offset + 12, section.center.z, true);
	view.setFloat32(offset + 16, section.halfExtent.x, true);
	view.setFloat32(offset + 20, section.halfExtent.y, true);
	view.setFloat32(offset + 24, section.halfExtent.z, true);
	view.setUint32(offset + 28, section.positionOffset, true);
	view.setUint32(offset + 32, section.normalOffset, true);
	view.setUint32(offset + 36, section.uvOffset, true);
	new Int16Array(output, section.positionOffset, section.positions.length).set(section.positions);
	new Int8Array(output, section.normalOffset, section.normals.length).set(section.normals);
	new Int16Array(output, section.uvOffset, section.uvs.length).set(section.uvs);
}

await writeFile(outputUrl, new Uint8Array(output));
console.log(`Wrote ${relative(rootDirectory, fileURLToPath(outputUrl))} (${output.byteLength} bytes).`);
