import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const textures = [
	{
		id: 'assorted-car',
		source: new URL('../src/assets/assorted-cars/textures/TrafficBody_01.png.006.png', import.meta.url),
	},
	{
		id: 'motorcycle',
		source: new URL('../src/assets/motorcycles/textures/Textures.png', import.meta.url),
	},
	{
		id: 'traverse',
		source: new URL('../src/assets/pickup-2024-chevrolet-traverse/textures/Ps1 Low-Poly 2024 Chevrolet Traverse_TEXTURE.jpeg', import.meta.url),
	},
	{
		id: 'mclaren',
		source: new URL('../src/assets/supercar-2024-mclaren-gts/textures/Lowpoly Ps1 2024 Mclaren GTS Texture.jpeg', import.meta.url),
	},
	{
		id: 'cargo-truck',
		source: new URL('../src/assets/trucks-collection/textures/Material Colors.jpeg', import.meta.url),
	},
	{
		id: 'city-truck',
		source: new URL('../src/assets/assorted-truck-and-bus/textures/TruckPlain.png', import.meta.url),
	},
	{
		id: 'city-bus',
		source: new URL('../src/assets/assorted-truck-and-bus/textures/Jetbus.png', import.meta.url),
	},
];

const outputDirectory = fileURLToPath(new URL('../src/assets/traffic-models/textures/', import.meta.url));
await mkdir(outputDirectory, { recursive: true });

for (const texture of textures) {
	const output = fileURLToPath(new URL(`../src/assets/traffic-models/textures/${texture.id}.webp`, import.meta.url));
	await sharp(fileURLToPath(texture.source))
		.resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 74, alphaQuality: 82 })
		.toFile(output);
	console.log(output.slice(dirname(outputDirectory).length + 1));
}
