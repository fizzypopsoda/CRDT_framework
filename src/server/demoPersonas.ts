import type { ResidentialCollegeCode } from "./college";

export type DemoPersona = {
    netId: string;
    college: ResidentialCollegeCode;
    displayName: string;
};

export const DEMO_PERSONAS: DemoPersona[] = [
    { netId: "jsmith12", college: "TD", displayName: "Jordan Smith" },
    { netId: "mwong23", college: "JE", displayName: "Morgan Wong" },
    { netId: "apatel08", college: "SM", displayName: "Asha Patel" },
    { netId: "lchen41", college: "GH", displayName: "Leo Chen" },
    { netId: "rkim19", college: "BR", displayName: "Riley Kim" },
    { netId: "slopez33", college: "ES", displayName: "Sofia Lopez" },
    { netId: "tjohnson07", college: "PS", displayName: "Taylor Johnson" },
    { netId: "ngarcia15", college: "SY", displayName: "Noah Garcia" },
    { netId: "mbrown29", college: "DC", displayName: "Morgan Brown" },
    { netId: "hdavis44", college: "MC", displayName: "Harper Davis" },
    { netId: "ewilson11", college: "BF", displayName: "Emery Wilson" },
    { netId: "omartinez26", college: "BK", displayName: "Olivia Martinez" },
    { netId: "ithomas38", college: "PM", displayName: "Iris Thomas" },
    { netId: "dlee22", college: "PS", displayName: "Dakota Lee" },
    { netId: "cwhite05", college: "TR", displayName: "Casey White" },
    { netId: "aharris31", college: "ES", displayName: "Avery Harris" },
];

export function pickRandomDemoPersona(): DemoPersona {
    return DEMO_PERSONAS[Math.floor(Math.random() * DEMO_PERSONAS.length)]!;
}
