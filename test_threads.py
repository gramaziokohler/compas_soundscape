import ai_edge_litert.interpreter as interpreter
import numpy as np
import time

print('Starting single thread benchmark with different num_threads...')
waveform = np.random.randn(16000*180).astype(np.float32)

def test_threads(n):
    interp = interpreter.Interpreter(model_path='backend/data/yamnet_model.tflite', num_threads=n)
    interp.allocate_tensors()
    ind = interp.get_input_details()[0]['index']
    oud = interp.get_output_details()[0]['index']
    t0 = time.time()
    pos = 0
    
    # Run only 10 frames to measure speed per frame
    for _ in range(10):
        frame = waveform[pos:pos+15600]
        if len(frame) < 15600: break
        interp.set_tensor(ind, frame)
        interp.invoke()
        out = interp.get_tensor(oud)[0]
        pos += 7680
    
    print(f'Threads {n} | 10 frames time: {time.time()-t0:.4f}s | Est 3 mins time: {(time.time()-t0)*37.5:.2f}s')

test_threads(1)
test_threads(4)
test_threads(8)
