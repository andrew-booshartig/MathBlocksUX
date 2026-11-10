/** Circuits to start from: the ones a theory class and an apprenticeship
 * work through — series, parallel, a divider, three- and four-way
 * switching, a start/stop station, AC with coils and capacitors, a
 * transformer, a panel's two sides. */
export const TEMPLATES: { id: string; label: string; group: string; code: string }[] = [
  {
    id: "series",
    label: "Series",
    group: "DC",
    code: `B1 battery 12 V @0,0
R1 resistor 2 Ω @4,-4
R2 resistor 4 Ω @10,0 r90
R3 resistor 6 Ω @5,4
wire 0,-2 0,-4 2,-4
wire 6,-4 10,-4 10,-2
wire 10,2 10,4 7,4
wire 3,4 0,4 0,2`,
  },
  {
    id: "parallel",
    label: "Parallel",
    group: "DC",
    code: `B1 battery 12 V @0,2
R1 resistor 4 Ω @5,2 r90
R2 resistor 6 Ω @10,2 r90
R3 resistor 12 Ω @15,2 r90
wire 0,0 15,0
wire 0,4 15,4`,
  },
  {
    id: "series-parallel",
    label: "Series–parallel",
    group: "DC",
    code: `B1 battery 12 V @0,2
R1 resistor 4 Ω @4,0
R2 resistor 6 Ω @9,2 r90
R3 resistor 3 Ω @14,2 r90
wire 0,0 2,0
wire 6,0 14,0
wire 0,4 14,4`,
  },
  {
    id: "divider",
    label: "Voltage divider",
    group: "DC",
    code: `B1 battery 12 V @0,4
R1 resistor 2 kΩ @6,2 r90
R2 resistor 1 kΩ @6,6 r90
VM1 voltmeter @11,6 r90
G1 ground @0,8
wire 0,2 0,0 6,0
wire 0,6 0,8 6,8
wire 6,4 11,4
wire 6,8 11,8
note "Vout = Vin × R2 / (R1 + R2)" @13,1`,
  },
  {
    id: "lamp",
    label: "Switch, fuse and lamp",
    group: "DC",
    code: `B1 battery 12 V @0,2
F1 fuse 5 A @4,0
S1 switch @10,0 state=closed
L1 lamp 6 W 12 V @15,2 r90
wire 0,0 2,0
wire 6,0 8,0
wire 12,0 15,0
wire 0,4 15,4`,
  },
  {
    id: "led",
    label: "LED and resistor",
    group: "DC",
    code: `B1 battery 9 V @0,2
R1 resistor 330 Ω @4,0
D1 led red @9,2 r90
wire 0,0 2,0
wire 6,0 9,0
wire 0,4 9,4
note "R = (Vs − Vf) / I" @12,1`,
  },
  {
    id: "bridge",
    label: "Wheatstone bridge",
    group: "DC",
    code: `B1 battery 10 V @0,4
R1 resistor 100 Ω @4,2 r90
R2 resistor 200 Ω @12,2 r90
R3 resistor 200 Ω @4,6 r90
R4 resistor 100 Ω @12,6 r90
VM1 voltmeter @8,4
wire 0,2 0,0 12,0
wire 0,6 0,8 12,8
wire 4,4 6,4
wire 10,4 12,4`,
  },
  {
    id: "three-way",
    label: "3-way switches",
    group: "Wiring",
    code: `V1 ac 120 V 60 Hz @0,3
S1 switch3 @4,1
S2 switch3 @10,1 flip
L1 lamp 60 W @16,3 r90
wire 0,1 2,1 black
wire 6,0 8,0 red
wire 6,2 8,2 black
wire 12,1 16,1 black
wire 0,5 16,5 white
note "Travelers between the switches; either one turns the light on or off" @0,-2`,
  },
  {
    id: "four-way",
    label: "4-way switch",
    group: "Wiring",
    code: `V1 ac 120 V 60 Hz @0,3
S1 switch3 @4,1
S2 switch4 @10,1
S3 switch3 @16,1 flip
L1 lamp 60 W @22,3 r90
wire 0,1 2,1 black
wire 6,0 8,0 red
wire 6,2 8,2 black
wire 12,0 14,0 red
wire 12,2 14,2 black
wire 18,1 22,1 black
wire 0,5 22,5 white`,
  },
  {
    id: "panel",
    label: "Panel: 120 V and 240 V",
    group: "Wiring",
    code: `P1 panel 120/240 V @0,0
L1 lamp 100 W @8,-2
WH1 resistor 12.8 Ω @8,6
wire 2,-2 6,-2 black
wire 10,-2 12,-2 12,0 2,0 white
wire 2,2 4,2 4,6 6,6 red
wire 10,6 14,6 14,-4 4,-4 4,-2 black
note "120 V lamp: L1 to N" @6,-6
note "240 V water heater: L1 to L2" @6,8.5`,
  },
  {
    id: "start-stop",
    label: "Start/stop station",
    group: "Control",
    code: `V1 ac 120 V 60 Hz @-4,4
PB1 pbnc @3,2
PB2 pbno @9,2
K1 contactno M @9,5
K2 contactnc OL @15,2
M coil 120 V @20,2
K3 contactno M @9,8
PL1 pilot green @20,8
wire -4,2 -4,0 0,0 0,8
wire -4,6 -4,10 25,10 25,0
wire 0,2 1,2
wire 5,2 7,2 7,5
wire 11,2 11,5
wire 11,2 13,2
wire 17,2 18,2
wire 22,2 25,2
wire 0,8 7,8
wire 11,8 18,8
wire 22,8 25,8
note "Start / stop: Start pulls M in, M's own contact holds it, Stop drops it" @-4,-3
note "L1" @-0.6,-1
note "L2" @24.4,-1`,
  },
  {
    id: "rl",
    label: "RL circuit",
    group: "AC",
    code: `V1 ac 120 V 60 Hz @0,2
R1 resistor 30 Ω @4,0
L1 inductor 106 mH @9,2 r90
wire 0,0 2,0
wire 6,0 9,0
wire 0,4 9,4`,
  },
  {
    id: "rc",
    label: "RC circuit",
    group: "AC",
    code: `V1 ac 120 V 60 Hz @0,2
R1 resistor 100 Ω @4,0
C1 capacitor 22 µF @9,2 r90
wire 0,0 2,0
wire 6,0 9,0
wire 0,4 9,4`,
  },
  {
    id: "rlc",
    label: "RLC series",
    group: "AC",
    code: `V1 ac 120 V 60 Hz @0,2
R1 resistor 40 Ω @4,0
L1 inductor 200 mH @10,0
C1 capacitor 50 µF @15,2 r90
wire 0,0 2,0
wire 6,0 8,0
wire 12,0 15,0
wire 0,4 15,4`,
  },
  {
    id: "transformer",
    label: "Transformer",
    group: "AC",
    code: `V1 ac 120 V 60 Hz @0,0
T1 transformer 5:1 @5,0
R1 resistor 12 Ω @10,0 r90
wire 0,-2 3,-2
wire 0,2 3,2
wire 7,-2 10,-2
wire 7,2 10,2
note "120 V : 24 V" @3,-4.5`,
  },
];
