# Crops regions of ref/oyenza-overview.png (2559x1398, gitignored third-party frame) into ref/.
from PIL import Image
im = Image.open('ref/oyenza-overview.png')
for name, box in {'ref-sidebar': (0, 0, 422, 1398), 'ref-hero': (495, 198, 2473, 819), 'ref-breakdown': (495, 870, 1722, 1398), 'ref-rail': (1779, 870, 2473, 1398)}.items():
    im.crop(box).convert('RGB').save(f'ref/{name}.jpg', quality=82)
