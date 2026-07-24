# Porsche 911 GT2 / GT2 RS performance reference

Research date: 2026-07-20. Sources below are Porsche-owned first-party pages or Porsche press material. Values are factory-published figures, not independent test results.

## Scope and model-year ambiguity

Game asset is named `Porsche_911_GT2.obj`. Its only OBJ header is a generic MilkShape export comment; no generation, model year, engine output, or test specification is embedded in the file ([OBJ source](../src/assets/porsche-car-model/Porsche_911_GT2.obj#L1)). Companion texture metadata identifies a `GT2/911t` source path but no 996, 997, or 991 generation ([texture metadata](../src/assets/porsche-car-model/car/index.fsh#L1-L3)). Treating the mesh as one exact production year would be unsupported.

Porsche's own history shows why: the GT2 name covers multiple generations and specifications. The 996 GT2 launched in 2001 and later received a 483 PS update; the 997.1 GT2, 997.2 GT2 RS, and 991.2 GT2 RS then used different engines, transmissions, weights, and performance figures ([Porsche GT2 history](https://www.porsche.com/stories/mobility/the-legend-of-the-porsche-911-gt2/)). Use a performance envelope for tuning unless a generation is explicitly selected. The 997.1 GT2 is the closest default benchmark because the asset is named GT2 rather than GT2 RS; treat that as a tuning assumption, not an identification of the supplied mesh. Keep the 991.2 GT2 RS as a modern upper-bound reference.

## Factory performance figures

| Variant | Porsche model-year context | Power | 0–100 km/h | 0–60 mph | Top speed | First-party source |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 996 GT2, launch and update | Model year 2001 launch: 462 PS; enhanced 2003–05 edition: 483 PS | 462 / 483 PS | 4.0 s (2003–05 listing) | — | 319 km/h (198 mph, 2003–05 listing) | [Porsche Classic 996 GT2](https://www.porsche.com/australia/accessoriesandservice/classic/models/996/996-gt2/) |
| 997.1 911 GT2 | 2007 launch; rear-wheel drive, six-speed manual | 530 bhp | 3.7 s | — | 329 km/h (204 mph) | [Porsche 2007 GT2 press release](https://www.porsche.com/usa/aboutporsche/pressreleases/pag/?id=2007-07-16&pool=international-de) |
| 997.2 911 GT2 RS | 2010 launch; limited to 500 cars | 620 hp | 3.5 s | — | 330 km/h | [Porsche 2010 annual report](https://newsroom.porsche.com/dam/jcr%3A380046a5-c903-4216-9643-9e97228421a5/2010_Porsche%20AG%20-%20Annual%20and%20Sustainability%20Report%202010%20%28Short%20Fiscal%20Year%29.pdf), [Porsche Club News 3/10](https://files.porsche.com/filestore/download/uk/none/clubs-clubnews-archive2010-03/default/1b15d3c3-aeec-4f7a-a4d5-8524e2fd5ff7/Porsche-Club-News-03-10.pdf) |
| 991.2 911 GT2 RS | 2017 world premiere / 2018 US press material; rear-wheel drive, PDK | 700 hp (515 kW) | 2.8 s | 2.7 s (US press figure) | 340 km/h / 211 mph | [Porsche Newsroom 2017](https://newsroom.porsche.com/en/products/porsche-911-gt2-rs-world-premiere-festival-of-speed-2017-goodwood-13892.html), [Porsche US 2018 press kit](https://newsroom.porsche.com/dam/jcr%3A7b4d72bf-075f-4af0-bdbc-88491ef75b14/PCNA18_0106_us.pdf) |

Porsche's retrospective GT2 history reports the 997.1 as 3.6 s and 328 km/h, while its 2007 launch release reports 3.7 s and 329 km/h ([retrospective history](https://www.porsche.com/stories/mobility/the-legend-of-the-porsche-911-gt2/), [2007 release](https://www.porsche.com/usa/aboutporsche/pressreleases/pag/?id=2007-07-16&pool=international-de)). Keep those as a small published range; do not imply one exact number when comparing generations or units.

Porsche's 997.1 and 997.2 material publishes 0–100 km/h rather than a separate 0–60 mph result; `—` in the table means not published by the cited first-party source, not zero or an estimate.

The 991.2 sources use different acceleration standards: Porsche Newsroom gives 0–100 km/h in 2.8 s, while the US press kit gives 0–60 mph in 2.7 s and calls 211 mph its top track speed ([Newsroom 2017](https://newsroom.porsche.com/en/products/porsche-911-gt2-rs-world-premiere-festival-of-speed-2017-goodwood-13892.html), [US press kit](https://newsroom.porsche.com/dam/jcr%3A7b4d72bf-075f-4af0-bdbc-88491ef75b14/PCNA18_0106_us.pdf)). Do not substitute 0–60 for 0–100 or treat rounded km/h and mph values as separate model variants.

## Spatial calibration

Porsche lists the 997 911 GT2 at 4,469 mm long and 1,852 mm wide ([Porsche Centre Langley vehicle specification](https://finder.porsche.com/ca/en-CA/details/porsche-911-gt2-preowned-XLWN6O)). The packed game asset measures about 4.908842 by 2.156494 world units after `MODEL_SCALE = 1.1`. `vehicle.ts` uses length as longitudinal scale: one world unit is `4.469 / 4.908842 = 0.9104 m` along travel and one world-unit/second is `3.2774 km/h`. Width scale is tracked separately (`1.852 / 2.156494 = 0.8588 m` per packed-model width unit) and feeds the two-circle collision footprint, so both body dimensions affect handling.

At 20 km/h, controller now travels `6.102` world units/s: about `1.24` packed-car lengths each second. This keeps HUD speed and visible road travel tied to same metre scale; old `12.65 km/h` conversion made 20 km/h only `1.58` world units/s, less than half car length per second.

## Translation to current vehicle units

Current controller constants and conversion are in [`vehicle.ts`](../src/game/vehicle.ts#L42-L112): road launch acceleration `7.73 m/s²`, meadow acceleration `4.74 m/s²`, road cap `329 km/h`, meadow cap `177 km/h`, reverse cap `152 km/h`, and `3.2774 km/h` per world unit/s. Forward acceleration tapers with speed; longitudinal rates are converted into calibrated world units before integration.

| Controller quantity | Calculation | Result |
| --- | --- | ---: |
| Road displayed top speed | `100.383 × 3.2774` | 329 km/h |
| Meadow displayed top speed | `54.0057 × 3.2774` | 177 km/h |
| Road reverse displayed cap | `46.3778 × 3.2774` | 152 km/h |
| Road 0–100, straight and unobstructed | 0.05 s simulation steps with taper | ≈3.75 s |

The 3.75 s result is an inference from current constants and the tested timestep, assuming no steering, terrain drag, collision, or frame-quantization effects beyond that timestep ([speed and acceleration constants](../src/game/vehicle.ts#L42-L112), [longitudinal update](../src/game/vehicle.ts#L143-L178)). It sits close to Porsche's published 997.1 GT2 range of 3.6–3.7 s and is slower than the 991.2 GT2 RS's 2.8 s figure ([Porsche GT2 history](https://www.porsche.com/stories/mobility/the-legend-of-the-porsche-911-gt2/), [Porsche Newsroom 2017](https://newsroom.porsche.com/en/products/porsche-911-gt2-rs-world-premiere-festival-of-speed-2017-goodwood-13892.html)). World units now use car-length calibration, so displayed speed also produces visible travel at expected scale.

The `7.73 m/s²` launch value plus `SPEED_ACCELERATION_TAPER = 0.8` and curve `1.6` intentionally reaches the 997.1 benchmark without a linear acceleration jump. A 991.2-style 2.8 s target would require a materially stronger curve or a separate selectable handling profile; do not raise the map's world-speed cap solely to chase 340 km/h.

## Drift and cornering implications

Porsche identifies the 991.2 GT2 RS as rear-wheel drive with rear-axle steering and Ultra High Performance tyres, and describes its chassis as optimized for high cornering forces ([Porsche Newsroom 2017](https://newsroom.porsche.com/en/products/porsche-911-gt2-rs-world-premiere-festival-of-speed-2017-goodwood-13892.html)). That supports rear-driven launch slip and strong lateral grip as visual/handling cues, but it does not specify an arcade drift-speed-loss rate.

Current game steering applies speed-ratio-scaled `TURNING_DRAG = 15.44` world units/s²; handbrake adds `HANDBRAKE_DRAG = 23.16` before steering drag ([steering update](../src/game/vehicle.ts#L181-L208), [handbrake longitudinal update](../src/game/vehicle.ts#L143-L178)). At road cap, sustained handbrake steering with no throttle can therefore remove up to `38.6` world units/s², or about `126.5 km/h/s` under calibrated conversion. With throttle held, the handbrake throttle factor (`0.25`) and speed taper leave only a small drive term near the cap, so the same drag still produces a large short-drift speed loss. This is intentionally dramatic arcade behavior, not a measured GT2 RS property.

Recommended tuning interpretation:

- Keep normal road turning drag modest so high-grip rear-drive behavior retains momentum; current `15.44` calibrated units/s² is a visible cornering penalty at cap.
- Reserve stronger loss for explicit handbrake input; current extra `23.16` calibrated units/s² makes drift readable and controllable, but lower it if drift exits feel like braking rather than sliding.
- Preserve rear-slip effects during launch and handbrake turns. Porsche's rear-wheel-drive and UHP-tyre description supports the direction of those cues, while exact slip magnitude remains game design ([rear-drive / tyre details](https://newsroom.porsche.com/en/products/porsche-911-gt2-rs-world-premiere-festival-of-speed-2017-goodwood-13892.html), [rear-grip constants](../src/game/vehicle.ts#L98-L100)).
- Validate any change against both speedometer target and corner exit feel; matching 0–100 alone does not validate drift behavior.

## Source list

Accessed 2026-07-20:

- [Porsche: Used 911 GT2 dimensions and performance](https://finder.porsche.com/ca/en-CA/details/porsche-911-gt2-preowned-XLWN6O)
- [Porsche: The legend of the 911 GT2](https://www.porsche.com/stories/mobility/the-legend-of-the-porsche-911-gt2/)
- [Porsche Classic Australia: 911 GT2 (type 996)](https://www.porsche.com/australia/accessoriesandservice/classic/models/996/996-gt2/)
- [Porsche USA: New 911 GT2 with 530 Horsepower (2007)](https://www.porsche.com/usa/aboutporsche/pressreleases/pag/?id=2007-07-16&pool=international-de)
- [Porsche USA: 911 GT2 RS sold out (2010)](https://www.porsche.com/usa/aboutporsche/pressreleases/pag/?id=2010-10-20&pool=international-de)
- [Porsche AG Annual and Sustainability Report 2010](https://newsroom.porsche.com/dam/jcr%3A380046a5-c903-4216-9643-9e97228421a5/2010_Porsche%20AG%20-%20Annual%20and%20Sustainability%20Report%202010%20%28Short%20Fiscal%20Year%29.pdf)
- [Porsche Club News 3/10: 911 GT2 RS data sheet](https://files.porsche.com/filestore/download/uk/none/clubs-clubnews-archive2010-03/default/1b15d3c3-aeec-4f7a-a4d5-8524e2fd5ff7/Porsche-Club-News-03-10.pdf)
- [Porsche Newsroom: 911 GT2 RS world premiere (2017)](https://newsroom.porsche.com/en/products/porsche-911-gt2-rs-world-premiere-festival-of-speed-2017-goodwood-13892.html)
- [Porsche US 2018 911 GT2 RS press kit](https://newsroom.porsche.com/dam/jcr%3A7b4d72bf-075f-4af0-bdbc-88491ef75b14/PCNA18_0106_us.pdf)
