import ai_edge_litert.interpreter as interpreter
import numpy as np
import time
import os
from concurrent.futures import ThreadPoolExecutor

print('Starting concurrent benchmark...')
waveform = np.random.randn(16000*180).astype(np.float32)
num_samples = len(waveform)

# We want to process pos from 0 to num_samples in chunks of 7680.
positions = list(range(0, num_samples - 15600 + 1, 7680))
t0 = time.time()

# Pre-initialize one interpreter per thread
num_threads = os.cpu_count()
interpreters = []
for _ in range(num_threads):
    interp = interpreter.Interpreter(model_path='backend/data/yamnet_model.tflite', num_threads=1)
    interp.allocate_tensors()
    interpreters.append(interp)

import queue
interp_queue = queue.Queue()
for i in interpreters:
    interp_queue.put(i)

def process_pos(pos):
    interp = interp_queue.get()
    ind = interp.get_input_details()[0]['index']
    oud = interp.get_output_details()[0]['index']
    
    frame = waveform[pos:pos+15600]
    if len(frame) < 15600:
        frame = np.pad(frame, (0, 15600 - len(frame)), mode='constant', constant_values=0)
        
    interp.set_tensor(ind, frame)
    interp.invoke()
    out = interp.get_tensor(oud)[0].copy()
    
    interp_queue.put(interp)
    return out

with ThreadPoolExecutor(max_workers=num_threads) as executor:
    results = list(executor.map(process_pos, positions))

print(f'Concurrent Time ({num_threads} workers): {time.time()-t0:.2f}s')
