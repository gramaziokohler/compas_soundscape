'use client'

import { create } from 'zustand'
import { combine } from 'zustand/middleware'

type SquareValue = 'X' | 'O' | null;
type Squares = SquareValue[];

const useGameStore = create(
  combine({ squares: Array(9).fill(null) as Squares, xIsNext: true }, (set) => {
    return {
      setSquares: (nextSquares: Squares | ((prev: Squares) => Squares)) => {
        set((state) => ({
          squares:
            typeof nextSquares === 'function'
              ? nextSquares(state.squares)
              : nextSquares,
        }))
      },
      setXIsNext: (nextXIsNext: boolean | ((prev: boolean) => boolean)) => {
        set((state) => ({
          xIsNext:
            typeof nextXIsNext === 'function'
              ? nextXIsNext(state.xIsNext)
              : nextXIsNext,
        }))
      },
    }
  }),
)

interface SquareProps {
  value: SquareValue;
  onSquareClick: () => void;
}

function Square({ value, onSquareClick }: SquareProps) {
  return (
    <button
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        backgroundColor: '#fff',
        border: '1px solid #999',
        outline: 0,
        borderRadius: 0,
        fontSize: '1rem',
        fontWeight: 'bold',
      }}
      onClick={onSquareClick}
    >
      {value}
    </button>
  )
}

export default function Board() {
  const xIsNext = useGameStore((state) => state.xIsNext)
  const setXIsNext = useGameStore((state) => state.setXIsNext)
  const squares = useGameStore((state) => state.squares)
  const setSquares = useGameStore((state) => state.setSquares)
  const player: SquareValue = xIsNext ? 'X' : 'O'
  const winner = calculateWinner(squares)
  const turns = calculateTurns(squares)
  const status = calculateStatus(winner, turns, player)



  function handleClick(i: number) {
    if (squares[i] || winner) return
    const nextSquares = squares.slice()
    nextSquares[i] = player
    setSquares(nextSquares)
    setXIsNext(!xIsNext)

  }

  return (
    <>
        <div style={{ marginBottom: '0.5rem' }}>{status}</div>
        <div
        style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gridTemplateRows: 'repeat(3, 1fr)',
            width: 'calc(3 * 2.5rem)',
            height: 'calc(3 * 2.5rem)',
            border: '1px solid #999',
        }}
        >
        {squares.map((square, squareIndex) => (
            <Square
            key={squareIndex}
            value={square}
            onSquareClick={() => handleClick(squareIndex)}
            />
        ))}
        </div>
    </>
  )
}

function calculateWinner(squares: Squares): SquareValue {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ]

  for (let i = 0; i < lines.length; i++) {
    const [a, b, c] = lines[i]
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
      return squares[a]
    }
  }

  return null
}

function calculateTurns(squares: Squares): number {
  return squares.filter((square) => !square).length
}

function calculateStatus(winner: SquareValue, turns: number, player: SquareValue): string {
  if (!winner && !turns) return 'Draw'
  if (winner) return `Winner ${winner}`
  return `Next player: ${player}`
}
