"""Cloud (server): a team's projects made, deleted (into History's trash),
copied out and brought in whole. The browser's half is app/modules/cloud
(its file browser's create, delete, export and import).

API (started by the kernel): the Cloud (service/cloud.py), serving its routes
(adapters/routes.py, protocol/cloud.contract.json).
"""
from stilo.kernel import define_module
from .adapters.routes import add_routes
from .service.cloud import Cloud


def start(ctx):
    for used in ("file_types", "workspace"):
        ctx.use(used)
    cloud = Cloud(ctx.use("identity"), ctx.use("projects"), ctx.use("sync").directory, ctx.use("history").trash)
    add_routes(ctx.use("transport"), cloud)
    return cloud


MODULE = define_module(__file__, start)
