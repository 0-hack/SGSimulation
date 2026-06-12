import numpy as np
# EPSG:3857 georeferencing from the GeoTIFF tags (level 0)
X0, Y0, PX = 11532818.827667393, 168467.21034052968, 0.5971642834779467
R = 6378137.0
def lonlat_to_merc(lon, lat):
    return lon*np.pi/180*R, R*np.log(np.tan(np.pi/4 + lat*np.pi/180/2))
def merc_to_px(X, Y, level):  # -> col,row at pyramid level
    s = PX * (2**level)
    return (X - X0)/s, (Y0 - Y)/s
def px_to_merc(col, row, level):
    s = PX * (2**level)
    return X0 + col*s, Y0 - row*s
