# Vehicle performance reference for traffic profiles

Research date: 2026-07-27. Sources are manufacturer-owned pages, press releases, or manufacturer technical sheets. Figures describe named reference vehicles, **not** unnamed low-poly assets. Asset folders do not prove exact trim, drivetrain, model year, or vehicle mass.

## Use rules

- Measure packed mesh length and width at runtime/build time. Convert real-world reference dimensions into scene units; do not reuse Porsche hitbox dimensions.
- Use an oriented capsule or two-circle footprint from measured mesh length/width. Wheels, mirrors, exhausts, antennae, and riders stay visual-only unless deliberately part of collision gameplay.
- Apply source performance only when asset identity is known. Otherwise select a documented class profile below and label it as a game choice.
- Factory top speed is not urban traffic cruise speed. Traffic should cruise well below published maximums, obey avoidance/braking, and use published maximums only as hard capability ceilings.
- Manufacturer figures are test-condition/model-specific. Do not mix one model's acceleration with another model's weight or dimensions.

## Factory reference data

| Asset/class use | Official representative | Factory performance | Factory size / mass | Source |
| --- | --- | --- | --- | --- |
| Motorcycle | 2023 BMW M 1000 RR | 0-100 km/h: 3.1 s; top speed: 314 km/h | 2,073 mm long; 848 mm wide (with mirrors); 192 kg DIN unladen | [BMW Motorrad technical sheet](https://www.press.bmwgroup.com/austria/article/attachment/T0404400DE/567914) |
| Compact / ordinary car | Honda Civic 1.8 i-VTEC Type S | 0-100 km/h: 8.9 s; top speed: 205 km/h | 4,275 mm long; 1,785 mm wide; 1,196-1,317 kg kerb | [Honda Civic Type R and Type S technical release](https://hondanews.eu/eu/en/media/pressreleases/34434/civic-type-r-and-type-s) |
| Honda Civic asset, performance option | 2023 Honda Civic Type R | 0-100 km/h: 5.4 s; top speed: 275 km/h | 4,594 mm long; 1,890 mm wide; 1,429 kg kerb | [Honda 2023 Civic Type R specifications](https://hondanews.eu/gb/en/cars/media/pressreleases/429984/2023-honda-civic-type-r) |
| SUV / crossover | Ford Kuga 2.5-litre plug-in hybrid | 0-100 km/h: 9.2 s; top speed: 200 km/h | 1,564 kg kerb in cited technical sheet | [Ford Kuga technical specifications](https://media.ford.com/content/dam/fordmedia/Europe/documents/productReleases/Kuga/Kuga_Euro_TechSpec.pdf) |
| Pickup | Ford Ranger Raptor, Brazil specification | 0-100 km/h: 5.8 s | 5,360 mm long; 2,208 mm wide; 1,926 mm high; 3,270 mm wheelbase | [Ford Ranger Raptor launch release](https://media.ford.com/content/fordmedia/fsa/br/pt/news/20230/11/ford-lanca-a-ranger-raptor--a-picape-mais-rapida-e-capaz-do-merc.html) |
| Van | Ford Transit Courier 1.0 EcoBoost, five-speed manual | 0-100 km/h: 12.3 s; top speed: 173 km/h | 1,115 kg kerb; 1,765 kg gross vehicle mass | [Ford Transit Courier technical specifications](https://media.ford.com/content/dam/fordmedia/Europe/documents/productReleases/Transit%20Courier/TransitCourier_Specifications_EU.pdf) |
| Heavy truck | Volvo FH Electric, fully loaded reference configuration | Factory page reports 490 kW continuous output; no 0-100/top-speed figure | 40-tonne gross combination weight in cited configuration | [Volvo FH Electric factory press release](https://www.volvotrucks.com/en-en/news-stories/press-releases/2022/jan/volvos-heavy-duty-electric-truck-is-put-to-the-test-excels-in-both-range-and-energy-efficiency.html) |
| Supercar | 2024 McLaren GTS | 0-100 km/h: 3.2 s; top speed: 326 km/h (203 mph) | Treat supplied low-poly mesh as unverified size until measured; source release is exact GTS performance reference | [McLaren GTS launch announcement](https://www.mclaren.com/cars/gl_en/mclaren-collective/mclaren-news/post/the-new-mclaren-gts) |

## Interpretation for this project

### Classes with exact named asset support

`car-honda-civic` can use either profile only after choosing which Civic it represents:

- **Normal Civic:** 205 km/h cap, 8.9-second 0-100 reference.
- **Type R Civic:** 275 km/h cap, 5.4-second 0-100 reference.

Default should be normal Civic. Type R must be an explicit alternate traffic profile, not inferred from mesh shape.

`supercar-2024-mclaren-gts` can use McLaren GTS performance numbers. `pickup-2024-chevrolet-traverse` is named after a Chevrolet Traverse, which is an SUV, not a pickup. Do not assign it Ranger Raptor values unless its model changes to a true pickup asset.

### Generic traffic asset groups

`assorted-cars`, `assorted-truck-and-bus`, `trucks-collection`, and `motorcycles` contain collections rather than named individual production models. Give every spawned entity a **vehicle class**, then pick a bounded profile:

| Class | Evidence-backed capability range | Safe interpretation for urban traffic |
| --- | --- | --- |
| Motorcycle | Sport-bike reference: 314 km/h, 3.1 s 0-100 | Highest power-to-mass and smallest hitbox. Strong launch, high steering response, low impact mass. Do not make every bike a 314 km/h superbike. |
| Compact car | Civic reference: 205 km/h, 8.9 s 0-100 | Default automobile profile. |
| Performance Civic / hot hatch | 275 km/h, 5.4 s 0-100 | Rare faster car profile. |
| SUV | 200 km/h, 9.2 s 0-100 | Larger hitbox/mass than compact; lower lateral response. |
| Pickup | Raptor reference: 5.8 s 0-100 | Larger collision footprint. Generic pickups should not inherit Raptor launch unless marked performance pickup. |
| Van | 173 km/h, 12.3 s 0-100 | Slow launch, tall body, moderate impact mass. |
| Heavy truck / bus | No comparable factory 0-100 or top speed published in source; cited loaded truck is 40 tonnes | Very high impact mass, slow acceleration. Use local road speed policy for cap rather than inventing a factory top speed. |
| Supercar | GTS: 326 km/h, 3.2 s 0-100 | Rare profile. Strong acceleration but do not let ambient traffic reach maximum on city grid. |

### Physics implications

- **Steering and wheels:** front wheel groups steer for every vehicle with a front axle. Motorcycle uses one front wheel plus fork/handlebar rotation. Trailer axles and rear truck wheels do not steer unless model supports it.
- **Body response:** use same longitudinal/lateral load signals already used by Porsche. Scale pitch/roll and squash/stretch down for heavy truck/bus; motorcycle should lean toward turn instead of applying car-style body roll.
- **Terrain:** use same road/meadow/grass logic. Scale drag with class: motorcycle and supercar lose speed sharply off road; truck/SUV/pickup retain more low-speed progress but still incur grass resistance.
- **Smoke and trails:** emit only from driven-wheel contact. More visible launch/skid smoke for rear-drive supercar and pickup; restrained smoke for normal traffic; motorcycle gets narrow single-track marks. Never derive speedometer speed from wheel animation.
- **Impact:** collision body must use measured mesh dimensions and per-class mass. Heavy-truck `40 tonnes` is gross combination mass with load/trailer; use a clamped gameplay mass for a solo visual truck, then tune impact impulse so cars can be displaced without catapulting the map.

## Missing factory data

Manufacturers often omit top speed and 0-100 values for utility vehicles and variants. Missing values stay missing; do not fill them with magazine tests. For unnamed assets, mesh measurement plus a class profile is more defensible than pretending source data identifies a specific model.

## Source list

- [BMW Motorrad M 1000 RR technical sheet](https://www.press.bmwgroup.com/austria/article/attachment/T0404400DE/567914)
- [Honda Civic Type R and Type S technical release](https://hondanews.eu/eu/en/media/pressreleases/34434/civic-type-r-and-type-s)
- [Honda 2023 Civic Type R specifications](https://hondanews.eu/gb/en/cars/media/pressreleases/429984/2023-honda-civic-type-r)
- [Ford Kuga technical specifications](https://media.ford.com/content/dam/fordmedia/Europe/documents/productReleases/Kuga/Kuga_Euro_TechSpec.pdf)
- [Ford Ranger Raptor launch release](https://media.ford.com/content/fordmedia/fsa/br/pt/news/20230/11/ford-lanca-a-ranger-raptor--a-picape-mais-rapida-e-capaz-do-merc.html)
- [Ford Transit Courier technical specifications](https://media.ford.com/content/dam/fordmedia/Europe/documents/productReleases/Transit%20Courier/TransitCourier_Specifications_EU.pdf)
- [Volvo FH Electric factory press release](https://www.volvotrucks.com/en-en/news-stories/press-releases/2022/jan/volvos-heavy-duty-electric-truck-is-put-to-the-test-excels-in-both-range-and-energy-efficiency.html)
- [McLaren GTS launch announcement](https://www.mclaren.com/cars/gl_en/mclaren-collective/mclaren-news/post/the-new-mclaren-gts)
