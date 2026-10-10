"""The app's own disk-capacity ledger.

Reservations stop the app from overcommitting the volume against itself
(outstanding upload bytes now, render output later). Outside programs can still
fill the disk, so writers also handle ``ENOSPC``.
"""

import shutil
import threading
from pathlib import Path
from typing import Callable, Dict, Tuple, Union

GIB = 1024**3
MIN_FREE_BYTES = 5 * GIB
MIN_FREE_FRACTION = 0.10

DiskUsage = Callable[[Union[str, Path]], Tuple[int, int, int]]


class ReservationLedger:
    def __init__(self, disk_usage: DiskUsage = shutil.disk_usage) -> None:
        self._disk_usage = disk_usage
        self._lock = threading.Lock()
        self._reserved: Dict[str, int] = {}

    def total(self) -> int:
        with self._lock:
            return sum(self._reserved.values())

    def set(self, key: str, nbytes: int) -> None:
        with self._lock:
            if nbytes > 0:
                self._reserved[key] = nbytes
            else:
                self._reserved.pop(key, None)

    def release(self, key: str) -> None:
        with self._lock:
            self._reserved.pop(key, None)

    def reserve_if_fits(self, path: Union[str, Path], key: str, nbytes: int) -> bool:
        """Atomically check shared reservations and reserve *nbytes* if they fit."""
        with self._lock:
            total, _used, free = self._disk_usage(path)
            keep = max(MIN_FREE_BYTES, int(total * MIN_FREE_FRACTION))
            outstanding = sum(self._reserved.values())
            if free - outstanding - nbytes < keep:
                return False
            if nbytes > 0:
                self._reserved[key] = nbytes
            return True

    def reserved(self, key: str) -> int:
        with self._lock:
            return self._reserved.get(key, 0)

    def can_fit(self, path: Union[str, Path], nbytes: int, *, excluding: str = "") -> bool:
        """True if *nbytes* more fits while keeping max(5 GiB, 10 %) free."""
        with self._lock:
            total, _used, free = self._disk_usage(path)
            keep = max(MIN_FREE_BYTES, int(total * MIN_FREE_FRACTION))
            outstanding = sum(v for k, v in self._reserved.items() if k != excluding)
            return free - outstanding - nbytes >= keep
