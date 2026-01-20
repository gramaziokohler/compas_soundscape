// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================

const CONFIG = {
    // Changing to FuMa (Classic B-Format)
    // Common in older academic libraries and some field recorders.
    FORMAT: 'FuMa', 

    // Radius of the virtual speaker cube (meters)
    CUBE_RADIUS: 2.0, 
};

// --- FuMa GAIN CALCULATION ---
// In FuMa, W is stored attenuated by 1/sqrt(2) approx 0.707.
// To decode correctly (reconstruct the sound field pressure), 
// we must boost W by sqrt(2) relative to X, Y, Z.
// Note: We also apply an overall 0.5 scaling often used to prevent clipping 
// when summing coherent signals, but here we focus on relative balance.
const W_GAIN = Math.sqrt(2); 

// --- FuMa CHANNEL MAPPING ---
// Order: 0:W, 1:X, 2:Y, 3:Z
const CH_MAP = { 
    W: 0, 
    X: 1, 
    Y: 2, 
    Z: 3 
}; 

// ==========================================
// 2. THE ENGINE
// ==========================================

export class AmbisonicVirtualRoom {
    private ctx: AudioContext;
    private ambisonicBus: GainNode;
    private busSplitter: ChannelSplitterNode;
    private speakers: PannerNode[];

    constructor(audioCtx: AudioContext) {
        this.ctx = audioCtx;
        
        // --- A. The Master Bus ---
        this.ambisonicBus = this.ctx.createGain();
        this.ambisonicBus.channelCount = 4;
        this.ambisonicBus.channelCountMode = 'explicit';
        this.ambisonicBus.channelInterpretation = 'discrete';
        
        // --- B. The Splitter ---
        this.busSplitter = this.ctx.createChannelSplitter(4);
        this.ambisonicBus.connect(this.busSplitter);

        // --- C. Setup Virtual Speakers ---
        this.speakers = [];
        this.setupVirtualCube();

        // --- D. Initialize Listener ---
        this.initListener();
    }

    getCubeVectors() {
        const norm = 1 / Math.sqrt(3); 
        const r = CONFIG.CUBE_RADIUS;
        const dist = norm * r;

        // Standard WebAudio Coords: +X (Right), +Y (Up), -Z (Forward)
        return [
            [-dist,  dist, -dist], // Front-Left-Up
            [ dist,  dist, -dist], // Front-Right-Up
            [-dist, -dist, -dist], // Front-Left-Down
            [ dist, -dist, -dist], // Front-Right-Down
            [-dist,  dist,  dist], // Back-Left-Up
            [ dist,  dist,  dist], // Back-Right-Up
            [-dist, -dist,  dist], // Back-Left-Down
            [ dist, -dist,  dist]  // Back-Right-Down
        ];
    }

    setupVirtualCube() {
        const vectors = this.getCubeVectors();

        vectors.forEach((pos) => {
            const panner = this.ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse'; 
            panner.rolloffFactor = 0; // Disable distance volume changes
            
            panner.positionX.value = pos[0];
            panner.positionY.value = pos[1];
            panner.positionZ.value = pos[2];

            panner.connect(this.ctx.destination);

            const speakerSummingNode = this.ctx.createGain();
            // Optional: Reduce global gain to prevent clipping with 8 speakers summing
            speakerSummingNode.gain.value = 1.0 / 8.0; 
            speakerSummingNode.connect(panner);

            this.connectDecoderMatrix(speakerSummingNode, pos);
            
            this.speakers.push(panner);
        });
    }

    connectDecoderMatrix(destinationNode: AudioNode, positionVector: number[]): void {
        const [x, y, z] = positionVector;
        const magnitude = Math.sqrt(x*x + y*y + z*z);
        
        // Direction Unit Vectors
        const uX = x / magnitude; 
        const uY = y / magnitude; 
        const uZ = z / magnitude;

        // --- MAPPING AUDIO GEOMETRY TO WEBAUDIO GEOMETRY ---
        // FuMa definition: +X Forward, +Y Left, +Z Up
        // WebAudio definition: +X Right, +Y Up, -Z Forward

        // 1. W Channel (Omni)
        const gW = this.ctx.createGain();
        gW.gain.value = W_GAIN; 
        this.busSplitter.connect(gW, CH_MAP.W); // Index 0
        gW.connect(destinationNode);

        // 2. X Channel (Audio: Front/Back)
        // Map to WebAudio Z axis (inverted, because WA Z is positive-back)
        const gX = this.ctx.createGain();
        gX.gain.value = -uZ; 
        this.busSplitter.connect(gX, CH_MAP.X); // Index 1
        gX.connect(destinationNode);

        // 3. Y Channel (Audio: Left/Right)
        // Map to WebAudio X axis (inverted, because WA X is positive-right, Audio Y is positive-left)
        const gY = this.ctx.createGain();
        gY.gain.value = -uX; 
        this.busSplitter.connect(gY, CH_MAP.Y); // Index 2
        gY.connect(destinationNode);

        // 4. Z Channel (Audio: Up/Down)
        // Map to WebAudio Y axis (Matches: +Y is Up)
        const gZ = this.ctx.createGain();
        gZ.gain.value = uY; 
        this.busSplitter.connect(gZ, CH_MAP.Z); // Index 3
        gZ.connect(destinationNode);
    }

    addSource(monoBuffer: AudioBuffer, bFormatIRBuffer: AudioBuffer): AudioBufferSourceNode {
        const source = this.ctx.createBufferSource();
        source.buffer = monoBuffer;

        const convolver = this.ctx.createConvolver();
        convolver.normalize = false; 
        convolver.buffer = bFormatIRBuffer; 
        
        source.connect(convolver);
        convolver.connect(this.ambisonicBus); 

        return source;
    }

    initListener() {
        const listener = this.ctx.listener;
        if(listener.positionX) {
            listener.positionX.value = 0;
            listener.positionY.value = 0;
            listener.positionZ.value = 0;
            listener.forwardX.value = 0;
            listener.forwardY.value = 0;
            listener.forwardZ.value = -1;
            listener.upX.value = 0;
            listener.upY.value = 1;
            listener.upZ.value = 0;
        } else {
            listener.setPosition(0,0,0);
            listener.setOrientation(0,0,-1, 0,1,0);
        }
    }

    updateHeadOrientation(forward: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }): void {
        const listener = this.ctx.listener;
        if(listener.forwardX) {
            const t = this.ctx.currentTime;
            listener.forwardX.setTargetAtTime(forward.x, t, 0.01);
            listener.forwardY.setTargetAtTime(forward.y, t, 0.01);
            listener.forwardZ.setTargetAtTime(forward.z, t, 0.01);
            listener.upX.setTargetAtTime(up.x, t, 0.01);
            listener.upY.setTargetAtTime(up.y, t, 0.01);
            listener.upZ.setTargetAtTime(up.z, t, 0.01);
        }
    }
}