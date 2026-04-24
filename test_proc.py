import ai_edge_litert.interpreter as interpreter
import numpy as np
import time
from concurrent.futures import ProcessPoolExecutor

def f(args):
    i_str, wave_frame = args
    import ai_edge_litert.interpreter as interpreter
    interp = interpreter.Interpreter(model_path='backend/data/yamnet_model.tflite', num_threads=1)
    interp.allocate_tensors()
    idx = interp.get_input_details()[0]['index']
    oud = interp.get_output_details()[0]['index']
    interp.set_tensor(idx, wave_frame)
    interp.invoke()
    return interp.get_tensor(oud)[0]

if __name__ == '__main__':
    wave = np.zeros((8, 15600), dtype=np.float32)
    args = [(i, wave[i]) for i in range(8)]
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(f, args))
    print('Time:', time.time() - t0)
