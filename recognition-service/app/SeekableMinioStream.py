class SeekableMinioStream:
    def __init__(self, obj):
        self.obj = obj
        self.buffer = bytearray()
        self.pos = 0
        self.finished = False

    def read(self, n=-1):
        if n == -1:
            self._fill_to_end()
            data = self.buffer[self.pos:]
            self.pos = len(self.buffer)
            return bytes(data)

        self._fill_to(self.pos + n)
        data = self.buffer[self.pos:self.pos + n]
        self.pos += len(data)
        return bytes(data)

    def seek(self, offset, whence=0):
        if whence == 0:  # absolute
            self._fill_to(offset)
            self.pos = offset
        elif whence == 1:  # relative
            return self.seek(self.pos + offset, 0)
        elif whence == 2:  # from end
            self._fill_to_end()
            self.pos = len(self.buffer) + offset
        else:
            raise ValueError("Invalid whence")
        return self.pos

    def tell(self):
        return self.pos

    def _fill_to(self, target):
        while len(self.buffer) < target and not self.finished:
            chunk = self.obj.read(64 * 1024)
            if not chunk:
                self.finished = True
                break
            self.buffer.extend(chunk)

    def _fill_to_end(self):
        while not self.finished:
            chunk = self.obj.read(64 * 1024)
            if not chunk:
                self.finished = True
                break
            self.buffer.extend(chunk)
