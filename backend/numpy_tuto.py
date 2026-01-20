import numpy as np

# Creating a 2x3 matrix from a list
matrix = np.array([[1, 2, 3], [4, 5, 6]])

# Useful shortcut creators
zeros = np.zeros((3, 3))      # 3x3 matrix of 0s
print(zeros)
identity = np.eye(3)          # 3x3 Identity matrix
print(identity)
random = np.random.random((2, 2)) # 2x2 matrix with random floats

a = np.array([1, 2, 3, 4, 5, 6])
print(a)
b = a.reshape((2, 3))
print(b)
c = np.array(b, dtype=np.float32).reshape(-1, 1)
print(a)