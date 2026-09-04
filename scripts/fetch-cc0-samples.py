#!/usr/bin/env python3
"""
Idempotent downloader for CC0 / Public Domain spoken QA samples.

Downloads curated Archive.org (LibriVox) and Wikimedia Commons audio, trims to
10–30 s, writes mono MP3 under test/samples/cc0/, and regenerates
test/samples/ATTRIBUTION.md + test/samples/manifest.json.

Only CC0-1.0 and Public Domain sources are listed. Re-run anytime:
  python3 scripts/fetch-cc0-samples.py
"""
from __future__ import annotations

import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "test" / "samples"
OUT = SAMPLES / "cc0"
FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
UA = "LocalTransSub-QA/1.1 (CC0 sample fetcher; educational ASR/MT QA)"

# Each entry becomes one clip. Prefer 3 per language; duration 10–30 s after trim.
# license must be CC0-1.0 or Public Domain (LibriVox PD-Mark / PD / government PD).
CLIPS = [
    # English (LibriVox CC0 / PD) — cover en→* MT pairs via tgt
    {
        "id": "en-1",
        "src": "en",
        "tgt": "zh",
        "label": "English → Chinese (Grant memoirs ch.13)",
        "license": "CC0-1.0",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:LibriVox_-_Personal_Memoirs_of_U._S._Grant_13.mp3",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/c/c5/LibriVox_-_Personal_Memoirs_of_U._S._Grant_13.mp3",
        "startSec": 60,
        "durationSec": 20,
    },
    {
        "id": "en-2",
        "src": "en",
        "tgt": "de",
        "label": "English → German (Grant memoirs ch.24)",
        "license": "CC0-1.0",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:LibriVox_-_Personal_Memoirs_of_U._S._Grant_24.mp3",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/7/78/LibriVox_-_Personal_Memoirs_of_U._S._Grant_24.mp3",
        "startSec": 90,
        "durationSec": 20,
    },
    {
        "id": "en-3",
        "src": "en",
        "tgt": "fr",
        "label": "English → French (Grant memoirs ch.26)",
        "license": "CC0-1.0",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:LibriVox_-_Personal_Memoirs_of_U._S._Grant_26.mp3",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/e/e4/LibriVox_-_Personal_Memoirs_of_U._S._Grant_26.mp3",
        "startSec": 45,
        "durationSec": 20,
    },
    # Japanese — LibriVox CC0
    {
        "id": "ja-1",
        "src": "ja",
        "tgt": "en",
        "label": "Japanese → English (Eijitsu Syohin 01)",
        "license": "CC0-1.0",
        "sourceUrl": "https://archive.org/details/eijitsu_syohin_um_librivox",
        "downloadUrl": "https://archive.org/download/eijitsu_syohin_um_librivox/eijitsusyohin_01_natsume_64kb.mp3",
        "startSec": 30,
        "durationSec": 20,
    },
    {
        "id": "ja-2",
        "src": "ja",
        "tgt": "en",
        "label": "Japanese → English (Eijitsu Syohin 02)",
        "license": "CC0-1.0",
        "sourceUrl": "https://archive.org/details/eijitsu_syohin_um_librivox",
        "downloadUrl": "https://archive.org/download/eijitsu_syohin_um_librivox/eijitsusyohin_02_natsume_64kb.mp3",
        "startSec": 40,
        "durationSec": 20,
    },
    {
        "id": "ja-3",
        "src": "ja",
        "tgt": "en",
        "label": "Japanese → English (Futon 01)",
        "license": "CC0-1.0",
        "sourceUrl": "https://archive.org/details/futon_ek_1303_librivox",
        "downloadUrl": "https://archive.org/download/futon_ek_1303_librivox/futon_01_tayama_64kb.mp3",
        "startSec": 35,
        "durationSec": 20,
    },
    # Chinese — LibriVox PD
    {
        "id": "zh-1",
        "src": "zh",
        "tgt": "en",
        "label": "Chinese → English (Art of War)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/art_of_war_chinese_1506_librivox",
        "downloadUrl": "https://archive.org/download/art_of_war_chinese_1506_librivox/artofwar_01_sun_64kb.mp3",
        "startSec": 40,
        "durationSec": 20,
    },
    {
        "id": "zh-2",
        "src": "zh",
        "tgt": "en",
        "label": "Chinese → English (Di Zi Gui)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/di_zi_gui_0805_librivox",
        "downloadUrl": "https://archive.org/download/di_zi_gui_0805_librivox/dizigui_mandarin_liyuexiu_64kb.mp3",
        "startSec": 20,
        "durationSec": 20,
    },
    {
        "id": "zh-3",
        "src": "zh",
        "tgt": "en",
        "label": "Chinese → English (Bible John 3:16, Commons CC0)",
        "license": "CC0-1.0",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Bible_John_3-16_In_Standard_Chinese.ogg",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/a/ae/Bible_John_3-16_In_Standard_Chinese.ogg",
        "startSec": 5,
        "durationSec": 25,
    },
    # Korean — LibriVox PD-Mark
    {
        "id": "ko-1",
        "src": "ko",
        "tgt": "en",
        "label": "Korean → English (Hyun short stories 01)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/short_stories_hyun_1411_librivox",
        "downloadUrl": "https://archive.org/download/short_stories_hyun_1411_librivox/short_stories_01_hyun_64kb.mp3",
        "startSec": 30,
        "durationSec": 20,
    },
    {
        "id": "ko-2",
        "src": "ko",
        "tgt": "en",
        "label": "Korean → English (Hyun short stories 02)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/short_stories_hyun_1411_librivox",
        "downloadUrl": "https://archive.org/download/short_stories_hyun_1411_librivox/short_stories_02_hyun_64kb.mp3",
        "startSec": 45,
        "durationSec": 20,
    },
    {
        "id": "ko-3",
        "src": "ko",
        "tgt": "en",
        "label": "Korean → English (Assembly of Animals)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/animal_meeting_1509_librivox",
        "downloadUrl": "https://archive.org/download/animal_meeting_1509_librivox/animalmeeting_01_ahn_64kb.mp3",
        "startSec": 40,
        "durationSec": 20,
    },
    # German — Commons LibriVox PD
    {
        "id": "de-1",
        "src": "de",
        "tgt": "en",
        "label": "German → English (Bergkristall)",
        "license": "Public Domain",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:LibriVox_-_Bergkristall.ogg",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/f/fe/LibriVox_-_Bergkristall.ogg",
        "startSec": 120,
        "durationSec": 20,
    },
    {
        "id": "de-2",
        "src": "de",
        "tgt": "en",
        "label": "German → English (Rosegger Drachenbinderin)",
        "license": "Public Domain",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:LibriVox_-_Als_ich_zur_Drachenbinderin_ritt.ogg",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/e/ee/LibriVox_-_Als_ich_zur_Drachenbinderin_ritt.ogg",
        "startSec": 90,
        "durationSec": 20,
    },
    {
        "id": "de-3",
        "src": "de",
        "tgt": "en",
        "label": "German → English (Stifter Eigennutz)",
        "license": "Public Domain",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:LibriVox_-_Stifter_Eigennutz_und_Vaterland.ogg",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/0/01/LibriVox_-_Stifter_Eigennutz_und_Vaterland.ogg",
        "startSec": 60,
        "durationSec": 20,
    },
    # French — LibriVox PD
    {
        "id": "fr-1",
        "src": "fr",
        "tgt": "en",
        "label": "French → English (J'accuse)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/jaccuse_librivox",
        "downloadUrl": "https://archive.org/download/jaccuse_librivox/jaccuse_zola_64kb.mp3",
        "startSec": 60,
        "durationSec": 20,
    },
    {
        "id": "fr-2",
        "src": "fr",
        "tgt": "en",
        "label": "French → English (Fables La Fontaine 06)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/fables_de_la_fontaine_06-2_sm_0904_librivox",
        "downloadUrl": "https://archive.org/download/fables_de_la_fontaine_06-2_sm_0904_librivox/fables_06_01_lafontaine_sm_64kb.mp3",
        "startSec": 20,
        "durationSec": 20,
    },
    {
        "id": "fr-3",
        "src": "fr",
        "tgt": "en",
        "label": "French → English (Essais Livre I)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/essaislivre1_2411_librivox",
        "downloadUrl": "https://archive.org/download/essaislivre1_2411_librivox/essaislivre1_01_montaigne_64kb.mp3",
        "startSec": 40,
        "durationSec": 20,
    },
    # Spanish — LibriVox PD-Mark
    {
        "id": "es-1",
        "src": "es",
        "tgt": "en",
        "label": "Spanish → English (Ester 01)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/biblia_ester_1604_librivox",
        "downloadUrl": "https://archive.org/download/biblia_ester_1604_librivox/ester_01_rva_64kb.mp3",
        "startSec": 25,
        "durationSec": 20,
    },
    {
        "id": "es-2",
        "src": "es",
        "tgt": "en",
        "label": "Spanish → English (Ester 02)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/biblia_ester_1604_librivox",
        "downloadUrl": "https://archive.org/download/biblia_ester_1604_librivox/ester_02_rva_64kb.mp3",
        "startSec": 30,
        "durationSec": 20,
    },
    {
        "id": "es-3",
        "src": "es",
        "tgt": "en",
        "label": "Spanish → English (El Equipaje del Rey José)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/equipaje_1807_librivox",
        "downloadUrl": "https://archive.org/download/equipaje_1807_librivox/equipaje_01_perezgaldos_64kb.mp3",
        "startSec": 40,
        "durationSec": 20,
    },
    # Russian — LibriVox PD-Mark
    {
        "id": "ru-1",
        "src": "ru",
        "tgt": "en",
        "label": "Russian → English (Belkin tales 00)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/belkintales_1406_librivox",
        "downloadUrl": "https://archive.org/download/belkintales_1406_librivox/belkintales_00_pushkin_64kb.mp3",
        "startSec": 40,
        "durationSec": 20,
    },
    {
        "id": "ru-2",
        "src": "ru",
        "tgt": "en",
        "label": "Russian → English (Belkin tales 01)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/belkintales_1406_librivox",
        "downloadUrl": "https://archive.org/download/belkintales_1406_librivox/belkintales_01_pushkin_64kb.mp3",
        "startSec": 60,
        "durationSec": 20,
    },
    {
        "id": "ru-3",
        "src": "ru",
        "tgt": "en",
        "label": "Russian → English (Dvoryanskoe gnezdo)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/dvoryanskoegnezdo_1906_librivox",
        "downloadUrl": "https://archive.org/download/dvoryanskoegnezdo_1906_librivox/dvoryanskoegnezdo_01_turgenev_64kb.mp3",
        "startSec": 50,
        "durationSec": 20,
    },
    # Italian — LibriVox PD-Mark + Commons Spoken IT CC0
    {
        "id": "it-1",
        "src": "it",
        "tgt": "en",
        "label": "Italian → English (I Malavoglia 00)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/i_malavoglia_1303_librivox",
        "downloadUrl": "https://archive.org/download/i_malavoglia_1303_librivox/imalavoglia_00_verga_64kb.mp3",
        "startSec": 30,
        "durationSec": 20,
    },
    {
        "id": "it-2",
        "src": "it",
        "tgt": "en",
        "label": "Italian → English (I Malavoglia 01)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/i_malavoglia_1303_librivox",
        "downloadUrl": "https://archive.org/download/i_malavoglia_1303_librivox/imalavoglia_01_verga_64kb.mp3",
        "startSec": 50,
        "durationSec": 20,
    },
    {
        "id": "it-3",
        "src": "it",
        "tgt": "en",
        "label": "Italian → English (Spoken Wikipedia Journey)",
        "license": "CC0-1.0",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:It-Journey_(videogioco)-article.ogg",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/9/92/It-Journey_%28videogioco%29-article.ogg",
        "startSec": 30,
        "durationSec": 20,
    },
    # Dutch — LibriVox CC0 + Commons Spoken Wikipedia CC0
    {
        "id": "nl-1",
        "src": "nl",
        "tgt": "en",
        "label": "Dutch → English (Dik Trom 01)",
        "license": "CC0-1.0",
        "sourceUrl": "https://archive.org/details/dik_trom_4_1104_librivox",
        "downloadUrl": "https://archive.org/download/dik_trom_4_1104_librivox/trom4_01_kieviet_64kb.mp3",
        "startSec": 60,
        "durationSec": 20,
    },
    {
        "id": "nl-2",
        "src": "nl",
        "tgt": "en",
        "label": "Dutch → English (Dik Trom 02)",
        "license": "CC0-1.0",
        "sourceUrl": "https://archive.org/details/dik_trom_4_1104_librivox",
        "downloadUrl": "https://archive.org/download/dik_trom_4_1104_librivox/trom4_02_kieviet_64kb.mp3",
        "startSec": 50,
        "durationSec": 20,
    },
    {
        "id": "nl-3",
        "src": "nl",
        "tgt": "en",
        "label": "Dutch → English (Spoken Wikipedia Minecraft)",
        "license": "CC0-1.0",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Spoken_Wikipedia_-_A_Minecraft_Movie_(Dutch).ogg",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/8/86/Spoken_Wikipedia_-_A_Minecraft_Movie_%28Dutch%29.ogg",
        "startSec": 40,
        "durationSec": 20,
    },
    # Polish — LibriVox PD-Mark + FLAMRIC PD-USGov
    {
        "id": "pl-1",
        "src": "pl",
        "tgt": "en",
        "label": "Polish → English (Wigilja)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/wigilja_bozego_narodzenia_1201_librivox",
        "downloadUrl": "https://archive.org/download/wigilja_bozego_narodzenia_1201_librivox/wigiljabozegonarodzenia_1_dickens_64kb.mp3",
        "startSec": 40,
        "durationSec": 20,
    },
    {
        "id": "pl-2",
        "src": "pl",
        "tgt": "en",
        "label": "Polish → English (Tajemnica Baskerville)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/tajemnica_baskervile_1302_librivox",
        "downloadUrl": "https://archive.org/download/tajemnica_baskervile_1302_librivox/tajemnicabaskervillow_01_doyle_64kb.mp3",
        "startSec": 45,
        "durationSec": 20,
    },
    {
        "id": "pl-3",
        "src": "pl",
        "tgt": "en",
        "label": "Polish → English (FLAMRIC lesson, USGov PD)",
        "license": "Public Domain",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Polish_FLAMRIC_Phase_02_Book_01_Less_04_Si.ogg",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/5/58/Polish_FLAMRIC_Phase_02_Book_01_Less_04_Si.ogg",
        "startSec": 60,
        "durationSec": 20,
    },
    # Arabic — Spoken Wikipedia PD + LibriVox PD-Mark
    {
        "id": "ar-1",
        "src": "ar",
        "tgt": "en",
        "label": "Arabic → English (Spoken Wikipedia Airplane)",
        "license": "Public Domain",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Airplane_article_in_Arabic_Wikipedia.ogg",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/a/aa/Airplane_article_in_Arabic_Wikipedia.ogg",
        "startSec": 30,
        "durationSec": 20,
    },
    {
        "id": "ar-2",
        "src": "ar",
        "tgt": "en",
        "label": "Arabic → English (Spoken Wikipedia Guitar)",
        "license": "Public Domain",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Gitarre_article_Arabic_Wikipedia.ogg",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/8/8a/Gitarre_article_Arabic_Wikipedia.ogg",
        "startSec": 25,
        "durationSec": 20,
    },
    {
        "id": "ar-3",
        "src": "ar",
        "tgt": "en",
        "label": "Arabic → English (Kalila wa Dimna)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/kalilawadimna_2608_librivox",
        "downloadUrl": "https://archive.org/download/kalilawadimna_2608_librivox/kalilawadimna_01_ibnalmuqaffa_64kb.mp3",
        "startSec": 40,
        "durationSec": 20,
    },
    # Vietnamese — IA CC0 + Commons PD
    {
        "id": "vi-1",
        "src": "vi",
        "tgt": "en",
        "label": "Vietnamese → English (Tắt Đèn part 3)",
        "license": "CC0-1.0",
        "sourceUrl": "https://archive.org/details/tat-den-audio",
        "downloadUrl": "https://archive.org/download/tat-den-audio/phan-3.mp3",
        "startSec": 60,
        "durationSec": 20,
    },
    {
        "id": "vi-2",
        "src": "vi",
        "tgt": "en",
        "label": "Vietnamese → English (Tắt Đèn part 2)",
        "license": "CC0-1.0",
        "sourceUrl": "https://archive.org/details/tat-den-audio",
        "downloadUrl": "https://archive.org/download/tat-den-audio/phan-2.mp3",
        "startSec": 30,
        "durationSec": 20,
    },
    {
        "id": "vi-3",
        "src": "vi",
        "tgt": "en",
        "label": "Vietnamese → English (Thiệu 1972 speech)",
        "license": "Public Domain",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Thieu-Organization-Speech-1972.wav",
        "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/5/58/Thieu-Organization-Speech-1972.wav",
        "startSec": 10,
        "durationSec": 25,
    },
    # Indonesian — LibriVox PD (80 Hari) + optional government PD when Commons allows
    {
        "id": "id-1",
        "src": "id",
        "tgt": "en",
        "label": "Indonesian → English (80 Hari ch.01, LibriVox PD)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/mengelilingi_doenia_dalam_80_hari_2212_librivox",
        "downloadUrl": "https://archive.org/download/mengelilingi_doenia_dalam_80_hari_2212_librivox/80hari_01_verne_64kb.mp3",
        "startSec": 50,
        "durationSec": 20,
    },
    {
        "id": "id-2",
        "src": "id",
        "tgt": "en",
        "label": "Indonesian → English (80 Hari ch.02, LibriVox PD)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/mengelilingi_doenia_dalam_80_hari_2212_librivox",
        "downloadUrl": "https://archive.org/download/mengelilingi_doenia_dalam_80_hari_2212_librivox/80hari_02_verne_64kb.mp3",
        "startSec": 40,
        "durationSec": 20,
    },
    {
        "id": "id-3",
        "src": "id",
        "tgt": "en",
        "label": "Indonesian → English (80 Hari ch.03, LibriVox PD)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/mengelilingi_doenia_dalam_80_hari_2212_librivox",
        "downloadUrl": "https://archive.org/download/mengelilingi_doenia_dalam_80_hari_2212_librivox/80hari_03_verne_64kb.mp3",
        "startSec": 55,
        "durationSec": 20,
    },
    # Ukrainian — LibriVox CC0 / PD-Mark
    {
        "id": "uk-1",
        "src": "uk",
        "tgt": "en",
        "label": "Ukrainian → English (Glibov fables 005)",
        "license": "CC0-1.0",
        "sourceUrl": "https://archive.org/details/fables_glibov_1212_librivox",
        "downloadUrl": "https://archive.org/download/fables_glibov_1212_librivox/baiky_005_glibov_64kb.mp3",
        "startSec": 10,
        "durationSec": 20,
    },
    {
        "id": "uk-2",
        "src": "uk",
        "tgt": "en",
        "label": "Ukrainian → English (Glibov fables 056)",
        "license": "CC0-1.0",
        "sourceUrl": "https://archive.org/details/fables_glibov_1212_librivox",
        "downloadUrl": "https://archive.org/download/fables_glibov_1212_librivox/baiky_056_glibov_64kb.mp3",
        "startSec": 30,
        "durationSec": 20,
    },
    {
        "id": "uk-3",
        "src": "uk",
        "tgt": "en",
        "label": "Ukrainian → English (Folk tales)",
        "license": "Public Domain",
        "sourceUrl": "https://archive.org/details/folk_tales_2412_librivox",
        "downloadUrl": "https://archive.org/download/folk_tales_2412_librivox/yakivanzrobyvchudesne_01_hnatiuk_64kb.mp3",
        "startSec": 30,
        "durationSec": 20,
    },
]

# Extra English clips so every en→* MT pair has a matching src (reuse files with different tgt labels)
EXTRA_EN_TARGETS = [
    ("en-4", "es", "English → Spanish (Grant ch.13 @2m)", 120),
    ("en-5", "ru", "English → Russian (Grant ch.24 @3m)", 180),
    ("en-6", "it", "English → Italian (Grant ch.26 @2m)", 120),
    ("en-7", "id", "English → Indonesian (Grant ch.13 @3m)", 180),
    ("en-8", "vi", "English → Vietnamese (Grant ch.24 @4m)", 240),
]


def ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = url.split("?", 1)[0]
    if dest.exists() and dest.stat().st_size > 1024:
        return
    part = Path(str(dest) + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300, context=ssl_ctx()) as r, open(part, "wb") as f:
        shutil.copyfileobj(r, f)
    part.replace(dest)


def probe_duration(path: Path) -> float:
    cmd = [
        FFMPEG.replace("ffmpeg", "ffprobe") if "ffmpeg" in FFMPEG else "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    # fall back if ffprobe path odd
    if not Path(cmd[0]).exists():
        cmd[0] = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
    try:
        out = subprocess.check_output(cmd, text=True).strip()
        return float(out)
    except Exception:
        return 0.0


def trim_to_mp3(src: Path, dest: Path, start: float, duration: float) -> float:
    dest.parent.mkdir(parents=True, exist_ok=True)
    existing = probe_duration(dest) if dest.exists() else 0.0
    if dest.exists() and dest.stat().st_size > 8_000 and existing >= 8.0:
        return existing
    cmd = [
        FFMPEG,
        "-y",
        "-ss",
        str(start),
        "-t",
        str(duration),
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "48k",
        "-c:a",
        "libmp3lame",
        str(dest),
    ]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return probe_duration(dest) or duration


def expand_clips() -> list[dict]:
    clips = list(CLIPS)
    # Reuse Grant 13/24/26 downloads for remaining en→* pairs
    base = {
        "es": CLIPS[0],
        "ru": CLIPS[1],
        "it": CLIPS[2],
        "id": CLIPS[0],
        "vi": CLIPS[1],
    }
    for cid, tgt, label, start in EXTRA_EN_TARGETS:
        b = base[tgt]
        clips.append(
            {
                "id": cid,
                "src": "en",
                "tgt": tgt,
                "label": label,
                "license": b["license"],
                "sourceUrl": b["sourceUrl"],
                "downloadUrl": b["downloadUrl"],
                "startSec": start,
                "durationSec": 20,
            }
        )
    return clips


def write_attribution(clips: list[dict], durations: dict[str, float]) -> None:
    lines = [
        "# Sample attribution",
        "",
        "All audio under `test/samples/cc0/` is **CC0-1.0** or **Public Domain** only.",
        "No CC-BY / CC-BY-SA material is included.",
        "",
        "Re-download / regenerate with:",
        "",
        "```bash",
        "python3 scripts/fetch-cc0-samples.py",
        "```",
        "",
        "| File | Language | License | Source |",
        "| --- | --- | --- | --- |",
    ]
    for c in clips:
        rel = f"cc0/{c['id']}.mp3"
        lines.append(
            f"| `{rel}` | {c['src']}→{c['tgt']} | {c['license']} | [{c['sourceUrl']}]({c['sourceUrl']}) |"
        )
    lines += [
        "",
        "## Notes",
        "",
        "- LibriVox volunteer readings are released as Public Domain / Public Domain Mark / CC0.",
        "- Wikimedia Commons files were checked for LicenseShortName CC0 or Public Domain before inclusion.",
        "- Clips are trimmed to ~10–30 seconds (mono 16 kHz MP3) for local ASR/MT QA.",
        "",
    ]
    (SAMPLES / "ATTRIBUTION.md").write_text("\n".join(lines), encoding="utf-8")


def write_manifest(clips: list[dict], durations: dict[str, float]) -> None:
    samples = []
    for c in clips:
        samples.append(
            {
                "id": c["id"],
                "label": c["label"],
                "src": c["src"],
                "tgt": c["tgt"],
                "file": f"cc0/{c['id']}.mp3",
                "durationHint": round(durations.get(c["id"], c["durationSec"]), 1),
                "license": c["license"],
                "sourceUrl": c["sourceUrl"],
            }
        )
    payload = {"version": 2, "samples": samples}
    (SAMPLES / "manifest.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    if not Path(FFMPEG).exists():
        print(f"ffmpeg not found at {FFMPEG}", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    cache = OUT / ".cache"
    cache.mkdir(parents=True, exist_ok=True)

    clips = expand_clips()
    durations: dict[str, float] = {}
    failed: list[str] = []

    for c in clips:
        out_mp3 = OUT / f"{c['id']}.mp3"
        print(f"[{c['id']}] {c['label']}", flush=True)
        try:
            # Skip network entirely when the trimmed clip is already good.
            existing = probe_duration(out_mp3) if out_mp3.exists() else 0.0
            if out_mp3.exists() and out_mp3.stat().st_size > 8_000 and existing >= 8.0:
                durations[c["id"]] = existing
                print(f"  -> cached {out_mp3.relative_to(ROOT)} ({existing:.1f}s)", flush=True)
                continue

            import hashlib

            url = c["downloadUrl"].split("?", 1)[0]
            ext = Path(urllib.parse.urlparse(url).path).suffix or ".bin"
            raw_path = cache / f"{hashlib.sha1(url.encode()).hexdigest()}{ext}"
            legacy_full = cache / urllib.parse.quote(url, safe="")
            legacy_tail = cache / urllib.parse.quote(url, safe="")[-180:]
            for legacy in (legacy_full, legacy_tail):
                if legacy.exists() and legacy.stat().st_size > 1024 and not raw_path.exists():
                    raw_path = legacy
                    break
            download(url, raw_path)
            dur = trim_to_mp3(raw_path, out_mp3, c["startSec"], c["durationSec"])
            if dur < 8:
                raise RuntimeError(f"trimmed duration too short: {dur:.2f}s")
            durations[c["id"]] = dur
            print(f"  -> {out_mp3.relative_to(ROOT)} ({dur:.1f}s, {out_mp3.stat().st_size} bytes)", flush=True)
        except Exception as e:
            failed.append(f"{c['id']}: {e}")
            print(f"  FAIL: {e}", file=sys.stderr, flush=True)

    if failed:
        print("\nFailures:", file=sys.stderr)
        for f in failed:
            print(" -", f, file=sys.stderr)
        # Still write what we have for partial recovery
    write_attribution(clips, durations)
    write_manifest([c for c in clips if c["id"] in durations], durations)

    # Count per language
    from collections import Counter

    counts = Counter(c["src"] for c in clips if c["id"] in durations)
    print("\nClips per language:")
    for lang in sorted(counts):
        print(f"  {lang}: {counts[lang]}")
    short = [L for L in ["ja", "zh", "ko", "de", "fr", "es", "ru", "it", "nl", "pl", "ar", "vi", "id", "uk", "en"] if counts.get(L, 0) < 3]
    if short:
        print("SHORT:", ", ".join(short))
        return 2
    print("All 15 languages have ≥3 clips.")
    return 0 if not failed else 2


if __name__ == "__main__":
    raise SystemExit(main())
