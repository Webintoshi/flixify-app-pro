"""Create an original moving test pattern AVI; no provider media is involved."""
import argparse
from pathlib import Path
import struct


def chunk(kind, data):
    return kind + struct.pack('<I', len(data)) + data + (b'\0' if len(data) % 2 else b'')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    width, height, fps, frames = 320, 180, 10, 200
    frame_size = width * height * 3
    avih = struct.pack('<14I', 1000000 // fps, frame_size * fps, 0, 0x10, frames, 0, 1, frame_size, width, height, 0, 0, 0, 0)
    strh = struct.pack('<4s4sIHHIIIIIIIIhhhh', b'vids', b'DIB ', 0, 0, 0, 0, 1, fps, 0, frames,
                       frame_size, 0xffffffff, 0, 0, 0, width, height)
    strf = struct.pack('<IiiHHIIiiII', 40, width, height, 1, 24, 0, frame_size, 0, 0, 0, 0)
    hdrl = chunk(b'LIST', b'hdrl' + chunk(b'avih', avih) + chunk(b'LIST', b'strl' + chunk(b'strh', strh) + chunk(b'strf', strf)))
    movie = bytearray(b'movi')
    index = bytearray()
    for number in range(frames):
        row = bytearray()
        for column in range(width):
            row.extend(((column + number * 5) % 256, 60 + number % 128, 200 if (column // 40) % 2 else 40))
        frame = bytes(row) * height
        index.extend(struct.pack('<4sIII', b'00db', 0x10, len(movie), len(frame)))
        movie.extend(chunk(b'00db', frame))
    content = b'AVI ' + hdrl + chunk(b'LIST', bytes(movie)) + chunk(b'idx1', bytes(index))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(chunk(b'RIFF', content))


if __name__ == '__main__':
    main()
