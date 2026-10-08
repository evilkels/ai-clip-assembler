import hashlib
import math
from pathlib import Path

from lxml import etree


def assert_valid_fcpxml(xml_text: str) -> None:
    dtd_path = Path(__file__).parent / "fixtures" / "fcpxml" / "FCPXMLv1_10.dtd"
    dtd = etree.DTD(str(dtd_path))
    document = etree.fromstring(xml_text.encode())
    if not dtd.validate(document):
        raise AssertionError(str(dtd.error_log))


def assert_well_formed_xmeml(xml_text: str) -> None:
    if "<!DOCTYPE xmeml>" not in xml_text.splitlines()[:2]:
        raise AssertionError("XMEML must declare <!DOCTYPE xmeml>")
    root = etree.fromstring(xml_text.encode())
    if root.tag != "xmeml" or root.get("version") != "5":
        raise AssertionError("XMEML root must have version 5")

    sequence = root.find("sequence")
    if sequence is None:
        raise AssertionError("XMEML must contain a sequence")
    video_track = sequence.find("./media/video/track")
    if video_track is None:
        raise AssertionError("XMEML sequence must contain a video track")
    video_clipitems = video_track.findall("clipitem")
    if video_clipitems and sequence.findtext("duration") != video_clipitems[-1].findtext("end"):
        raise AssertionError("Sequence duration must equal the last video clip end")

    for previous, clipitem in zip(video_clipitems, video_clipitems[1:]):
        if clipitem.findtext("start") != previous.findtext("end"):
            raise AssertionError("Each video clipitem must start where the previous one ends")

    for rate in root.findall(".//rate"):
        if rate.findtext("timebase") is None or rate.findtext("ntsc") is None:
            raise AssertionError("Every rate must have timebase and ntsc")

    file_elements = root.findall(".//clipitem/file")
    file_ids = {file_element.get("id") for file_element in file_elements}
    for file_id in file_ids:
        definitions = [element for element in file_elements if element.get("id") == file_id and len(element)]
        if len(definitions) != 1:
            raise AssertionError(f"File {file_id} must have exactly one full definition")
        pathurl = definitions[0].findtext("pathurl")
        if pathurl is None or not pathurl.startswith("file://localhost/"):
            raise AssertionError(f"File {file_id} must have a localhost file URL")

    for clipitem in root.findall(".//clipitem"):
        has_time_remap = any(
            effect.findtext("name") == "Time Remap"
            for effect in clipitem.findall("filter/effect")
        )
        if not has_time_remap and clipitem.findtext("end") is not None:
            if int(clipitem.findtext("end")) - int(clipitem.findtext("start")) != int(clipitem.findtext("out")) - int(clipitem.findtext("in")):
                raise AssertionError("Normal-speed clipitem duration must match its source range")

    audio_tracks = sequence.findall("./media/audio/track")
    audio_clipitems = []
    for track in audio_tracks:
        audio_clipitems.extend(track.findall("clipitem"))
    video_by_id = {clipitem.get("id"): clipitem for clipitem in video_clipitems}
    for audio_clipitem in audio_clipitems:
        video_clipitem = video_by_id.get(audio_clipitem.get("id"))
        if video_clipitem is None or any(
            audio_clipitem.findtext(field) != video_clipitem.findtext(field)
            for field in ("start", "end")
        ):
            raise AssertionError("Audio clipitems must share their video id, start, and end")

    tracks_by_mediatype = {"video": sequence.findall("./media/video/track"), "audio": audio_tracks}
    for link in root.findall(".//link"):
        tracks = tracks_by_mediatype[link.findtext("mediatype")]
        track_index = int(link.findtext("trackindex"))
        clip_index = int(link.findtext("clipindex"))
        if not (1 <= track_index <= len(tracks)):
            raise AssertionError("Link points to a missing track")
        if not (1 <= clip_index <= len(tracks[track_index - 1].findall("clipitem"))):
            raise AssertionError("Link points to a missing clipitem")


class FakeEmbeddingProvider:
    def __init__(self, dim: int = 32):
        self.dim = dim

    def embed_images(self, paths: list[str]) -> list[list[float]]:
        return [self._embed_path(path) for path in paths]

    def _embed_path(self, path: str) -> list[float]:
        with open(path, "rb") as image_file:
            digest = hashlib.sha256(image_file.read()).digest()
        vector = [float(digest[index % len(digest)]) for index in range(self.dim)]
        norm = math.sqrt(sum(value * value for value in vector))
        return [value / norm for value in vector] if norm else []
