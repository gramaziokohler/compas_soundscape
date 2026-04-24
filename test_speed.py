import ai_edge_litert.interpreter as interpreter
import numpy as np
import time
import os

print('Starting benchmark...')
waveform = np.random.randn(16000*180).astype(np.float32)

def test_threads(n):
    interp = interpreter.Interpreter(model_path='backend/data/yamnet_model.tflite', num_threads=n)
    interp.allocate_tensors()
    ind = interp.get_input_details()[0]['index']
    oud = interp.get_output_details()[0]['index']
    t0 = time.time()
    pos = 0
    while pos < len(waveform)-15600:
        interp.set_tensor(ind, waveform[pos:pos+15600])
        interp.invoke()
        pos += 7680
    print(f'Threads: {n}, Time: {time.time()-t0:.2f}s')

test_threads(1)
try:
    test_threads(4)
    test_threads(os.cpu_count())
except Exception as e:
    print(e)
